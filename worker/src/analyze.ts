import { GoogleGenAI } from "@google/genai";
import type { AiAnalysisEntry, AiVerdict, Env } from "./types";
import { readAiAnalyses, writeAiAnalyses } from "./github";

const ANALYSIS_MODEL = "gemini-3.1-pro-preview";
// Queue + run-state KV keys.
const QUEUE_KV_KEY = "analyze:queue";
const META_KV_KEY = "analyze:meta";
const LOCK_KV_KEY = "analyze:lock";
const FAILED_TEXT_KV_KEY = "analyze:last-failed-text";
// 7 days — long enough that a paused/abandoned run survives normal poking.
const QUEUE_KV_TTL = 7 * 86400;
// Best-effort lock TTL: a single cron tick should never run longer than this,
// and if a worker dies mid-tick we want the next cron to pick up the slack.
const LOCK_TTL_SECONDS = 240;
// Per-tick processing budget. Each pair is one non-batch generateContent call
// with grounding (~10–25s). With concurrency 5 we stay inside the worker's
// wall-time budget while still making meaningful progress per minute.
const PAIRS_PER_TICK = 5;

interface RollupPlant {
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  zonesSeen: string[];
  kind?: string;
}

interface RollupZone {
  code: string;
  name: string | null;
}

interface Rollup {
  zones: RollupZone[];
  plants: RollupPlant[];
}

interface Pair {
  shortCode: string;
  zoneCode: string;
}

interface RunMeta {
  zoneFilter: string | null;
  total: number;
  succeeded: number;
  failed: number;
  promptTokens: number;
  outputTokens: number;
  startedAt: string;
  lastTickAt?: string;
  finishedAt?: string;
}

async function loadRollupParsed(env: Env): Promise<{ raw: string; rollup: Rollup }> {
  const base = env.DATA_BASE_URL ?? "https://plantyj.com/data";
  const res = await fetch(`${base}/rollup.min.json`, {
    cf: { cacheTtl: 60, cacheEverything: true } as RequestInitCfProperties,
  });
  if (!res.ok) throw new Error(`rollup fetch failed: ${res.status}`);
  const raw = await res.text();
  return { raw, rollup: JSON.parse(raw) as Rollup };
}

export function findMissingPairs(
  rollup: Rollup,
  existing: AiAnalysisEntry[],
  zoneFilter: string | null
): Pair[] {
  const have = new Set(existing.map((e) => `${e.shortCode}|${e.zoneCode}`));
  const out: Pair[] = [];
  for (const p of rollup.plants) {
    for (const z of p.zonesSeen) {
      if (zoneFilter && z !== zoneFilter) continue;
      const key = `${p.shortCode}|${z}`;
      if (!have.has(key)) out.push({ shortCode: p.shortCode, zoneCode: z });
    }
  }
  return out;
}

function buildSinglePairPrompt(
  rollupJson: string,
  pair: Pair,
  zoneFilter: string | null
): string {
  const filterNote = zoneFilter
    ? `\nThis run is scoped to zone "${zoneFilter}". Still consider neighboring zones and the property as a whole when judging ecological fit — don't restrict reasoning to that zone.`
    : "";

  return `You are analyzing the ecological niche of a single specimen (plant or animal) observed in a Minneapolis, MN garden journal. The property is on the NW corner of a city block, USDA hardiness zone 4b/5a, clay/loam soil. Owners prioritize native plants, edibles, medicinals, and supporting local ecology.${filterNote}

# Garden context (full rollup)
# Schema: zones[]: {code, name}; plants[]: {shortCode, fullName, commonName, tags, byZone, pics, zonesSeen, kind?, ...}
# "kind" may be "plant" or "animal"; if absent, treat as plant.
${rollupJson}

# Task
Decide a verdict (GOOD / BAD / MIXED) and write a 1–2 paragraph analysis for the specimen "${pair.shortCode}" in zone "${pair.zoneCode}". The verdict goes in its own "verdict" field — do NOT repeat it as a prefix in the analysis prose.

For PLANTS, cover:
- Whether the ecological niche is GOOD, BAD, or MIXED for that zone (factor in zone neighbors but don't restrict to them)
- Native insects served (pollinators, specialists, host relationships) and urban wildlife (birds, mammals)
- Practical concerns for this property (clay/loam, zone 4b/5a, native-priority owners)

For ANIMALS, cover:
- Whether the species' presence in that zone is GOOD, BAD, or MIXED for the garden's ecology and the owners' priorities
- What it eats, predates, pollinates, or competes with — given the plants currently in that zone and its neighbors
- Whether it is native, naturalized, or invasive in the Twin Cities area, and any management considerations

Use the googleSearch tool to ground claims in real sources. Do NOT include inline citation markers (e.g. [1], [1.3], [2, 3]) anywhere in the analysis prose — references are collected automatically from the grounding metadata, and inline markers corrupt the prose's spacing.

# Output format
Return ONLY a JSON object — no prose, no markdown fences, no commentary before or after. Exactly:
{
  "verdict": "GOOD" | "BAD" | "MIXED",
  "analysis": string
}
The "analysis" string should NOT begin with "GOOD." / "BAD." / "MIXED." — that information lives in "verdict". Begin your response with { and end it with }.`;
}

function stripJsonFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return t;
}

function stripInlineCitations(text: string): string {
  return text.replace(/\s*\[\d+(?:[.,]\s*\d+)*\]/g, "").replace(/[ \t]{2,}/g, " ");
}

function extractLeadingVerdict(text: string): { verdict: AiVerdict | null; rest: string } {
  const m = text.match(/^\s*(GOOD|BAD|MIXED)\b[.:\s-]+/i);
  if (!m) return { verdict: null, rest: text };
  return {
    verdict: m[1].toUpperCase() as AiVerdict,
    rest: text.slice(m[0].length),
  };
}

function coerceVerdict(v: unknown): AiVerdict | null {
  if (typeof v !== "string") return null;
  const u = v.trim().toUpperCase();
  return u === "GOOD" || u === "BAD" || u === "MIXED" ? u : null;
}

async function resolveRedirect(url: string): Promise<string> {
  try {
    const res = await fetch(url, { redirect: "manual" });
    const loc = res.headers.get("location");
    return loc && loc.startsWith("http") ? loc : url;
  } catch {
    return url;
  }
}

async function resolveRedirects(urls: string[], concurrency = 10): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= urls.length) return;
      const u = urls[idx];
      out.set(u, await resolveRedirect(u));
    }
  }
  const n = Math.min(concurrency, urls.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

interface PairResult {
  pair: Pair;
  entry?: AiAnalysisEntry;
  error?: string;
  promptTokens: number;
  outputTokens: number;
  diag: GroundingDiag;
}

interface GroundingDiag {
  shortCode: string;
  zoneCode: string;
  modelVersion: string | null;
  finishReason: string | null;
  webSearchQueries: string[];
  groundingChunkCount: number;
  groundingSupportCount: number;
  webChunkCount: number;
  hasUrlContextMetadata: boolean;
  // First few URIs (resolved or not) so we can eyeball the structure.
  sampleUris: string[];
}

function emptyDiag(pair: Pair): GroundingDiag {
  return {
    shortCode: pair.shortCode,
    zoneCode: pair.zoneCode,
    modelVersion: null,
    finishReason: null,
    webSearchQueries: [],
    groundingChunkCount: 0,
    groundingSupportCount: 0,
    webChunkCount: 0,
    hasUrlContextMetadata: false,
    sampleUris: [],
  };
}

async function analyzeOnePair(
  client: GoogleGenAI,
  rollupJson: string,
  pair: Pair,
  zoneFilter: string | null,
  now: string
): Promise<PairResult> {
  const prompt = buildSinglePairPrompt(rollupJson, pair, zoneFilter);
  let response;
  try {
    response = await client.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { tools: [{ googleSearch: {} }] },
    });
  } catch (err) {
    return {
      pair,
      error: `generateContent failed: ${(err as Error).message}`,
      promptTokens: 0,
      outputTokens: 0,
      diag: emptyDiag(pair),
    };
  }

  const candidate = response.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => (p as { text?: string }).text ?? "")
    .join("");
  const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

  const groundingMeta = candidate?.groundingMetadata;
  const groundingChunks = groundingMeta?.groundingChunks ?? [];
  const webChunks = groundingChunks.filter((c) => c.web?.uri);
  const diag: GroundingDiag = {
    shortCode: pair.shortCode,
    zoneCode: pair.zoneCode,
    modelVersion: response.modelVersion ?? null,
    finishReason: candidate?.finishReason ?? null,
    webSearchQueries: groundingMeta?.webSearchQueries ?? [],
    groundingChunkCount: groundingChunks.length,
    groundingSupportCount: groundingMeta?.groundingSupports?.length ?? 0,
    webChunkCount: webChunks.length,
    hasUrlContextMetadata: !!candidate?.urlContextMetadata,
    sampleUris: webChunks.slice(0, 3).map((c) => c.web?.uri ?? "").filter(Boolean),
  };

  if (!text.trim()) {
    return { pair, error: "empty response text", promptTokens, outputTokens, diag };
  }

  let parsed: { verdict?: unknown; analysis?: unknown };
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch (err) {
    return {
      pair,
      error: `JSON parse failed: ${(err as Error).message}`,
      promptTokens,
      outputTokens,
      diag,
    };
  }

  const rawAnalysis = typeof parsed.analysis === "string" ? parsed.analysis.trim() : "";
  if (!rawAnalysis) {
    return { pair, error: "missing analysis field", promptTokens, outputTokens, diag };
  }
  const stripped = extractLeadingVerdict(rawAnalysis);
  const verdict = coerceVerdict(parsed.verdict) ?? stripped.verdict;
  if (!verdict) {
    return { pair, error: "no verdict found", promptTokens, outputTokens, diag };
  }
  const analysis = stripInlineCitations(stripped.rest).trim();
  if (!analysis) {
    return { pair, error: "analysis empty after cleanup", promptTokens, outputTokens, diag };
  }

  // Per-pair grounding: every URL in groundingChunks applies to this single
  // entry. No offset matching needed.
  const rawUrls = new Set<string>();
  for (const chunk of groundingChunks) {
    const uri = chunk.web?.uri;
    if (typeof uri === "string" && uri.startsWith("http")) rawUrls.add(uri);
  }
  const resolved = await resolveRedirects(Array.from(rawUrls));
  const references = Array.from(rawUrls).map((u) => resolved.get(u) ?? u);

  return {
    pair,
    entry: {
      shortCode: pair.shortCode,
      zoneCode: pair.zoneCode,
      verdict,
      analysis,
      references,
      created: now,
    },
    promptTokens,
    outputTokens,
    diag,
  };
}

function elapsedSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export interface SubmitOk {
  ok: true;
  enqueued: number;
}
export interface SubmitErr {
  ok: false;
  message: string;
}

export async function submitAnalyzeRun(
  env: Env,
  zoneFilter: string | null
): Promise<SubmitOk | SubmitErr> {
  if (!env.ASK_CACHE) {
    return { ok: false, message: "KV not configured — analyze runs require ASK_CACHE." };
  }

  const queueRaw = await env.ASK_CACHE.get(QUEUE_KV_KEY);
  if (queueRaw) {
    const pending: Pair[] = JSON.parse(queueRaw);
    if (pending.length > 0) {
      return {
        ok: false,
        message: `A run is already in progress (${pending.length} pair(s) remaining). Run /analyze-load to check progress, or wait for the cron to drain it.`,
      };
    }
  }

  const { rollup } = await loadRollupParsed(env);
  if (zoneFilter && !rollup.zones.some((z) => z.code === zoneFilter)) {
    return { ok: false, message: `Unknown zone "${zoneFilter}". See /zones.` };
  }

  const { analyses: existing } = await readAiAnalyses(env);
  const pairs = findMissingPairs(rollup, existing, zoneFilter);
  if (pairs.length === 0) {
    return {
      ok: false,
      message: zoneFilter
        ? `All plants in zone "${zoneFilter}" already have analyses.`
        : "All specimen+zone pairs already have analyses.",
    };
  }

  const meta: RunMeta = {
    zoneFilter,
    total: pairs.length,
    succeeded: 0,
    failed: 0,
    promptTokens: 0,
    outputTokens: 0,
    startedAt: new Date().toISOString(),
  };
  await env.ASK_CACHE.put(QUEUE_KV_KEY, JSON.stringify(pairs), { expirationTtl: QUEUE_KV_TTL });
  await env.ASK_CACHE.put(META_KV_KEY, JSON.stringify(meta), { expirationTtl: QUEUE_KV_TTL });

  return { ok: true, enqueued: pairs.length };
}

export type StatusResult =
  | { kind: "no-run" }
  | {
      kind: "running" | "done";
      total: number;
      succeeded: number;
      failed: number;
      remaining: number;
      promptTokens: number;
      outputTokens: number;
      elapsed: string;
      zoneFilter: string | null;
    };

export async function analyzeStatus(env: Env): Promise<StatusResult> {
  if (!env.ASK_CACHE) return { kind: "no-run" };
  const metaRaw = await env.ASK_CACHE.get(META_KV_KEY);
  if (!metaRaw) return { kind: "no-run" };
  const meta: RunMeta = JSON.parse(metaRaw);
  const queueRaw = await env.ASK_CACHE.get(QUEUE_KV_KEY);
  const remaining = queueRaw ? (JSON.parse(queueRaw) as Pair[]).length : 0;
  return {
    kind: remaining === 0 ? "done" : "running",
    total: meta.total,
    succeeded: meta.succeeded,
    failed: meta.failed,
    remaining,
    promptTokens: meta.promptTokens,
    outputTokens: meta.outputTokens,
    elapsed: elapsedSince(meta.startedAt),
    zoneFilter: meta.zoneFilter,
  };
}

export interface TickResult {
  ranTick: boolean;
  reason?: string;
  processed?: number;
  succeeded?: number;
  failed?: number;
  remaining?: number;
}

// Drains up to PAIRS_PER_TICK pairs from the queue: runs them concurrently as
// non-batch generateContent calls, commits successful entries to GitHub, and
// updates run meta in KV. Called from the scheduled cron handler.
export async function processAnalyzeTick(env: Env): Promise<TickResult> {
  if (!env.ASK_CACHE) return { ranTick: false, reason: "no KV" };

  const queueRaw = await env.ASK_CACHE.get(QUEUE_KV_KEY);
  if (!queueRaw) return { ranTick: false, reason: "no queue" };
  const queue: Pair[] = JSON.parse(queueRaw);
  if (queue.length === 0) return { ranTick: false, reason: "queue empty" };

  // Best-effort lock — KV has no CAS, so this is racy but reduces overlap.
  const lockHeld = await env.ASK_CACHE.get(LOCK_KV_KEY);
  if (lockHeld) return { ranTick: false, reason: "locked" };
  await env.ASK_CACHE.put(LOCK_KV_KEY, new Date().toISOString(), {
    expirationTtl: LOCK_TTL_SECONDS,
  });

  try {
    const batch = queue.slice(0, PAIRS_PER_TICK);
    const remainingAfter = queue.slice(batch.length);
    // Pop the batch now so a subsequent tick won't re-pick it even if this
    // tick crashes mid-processing.
    await env.ASK_CACHE.put(QUEUE_KV_KEY, JSON.stringify(remainingAfter), {
      expirationTtl: QUEUE_KV_TTL,
    });

    const { raw: rollupJson } = await loadRollupParsed(env);
    const metaRaw = await env.ASK_CACHE.get(META_KV_KEY);
    const meta: RunMeta = metaRaw
      ? JSON.parse(metaRaw)
      : {
          zoneFilter: null,
          total: batch.length,
          succeeded: 0,
          failed: 0,
          promptTokens: 0,
          outputTokens: 0,
          startedAt: new Date().toISOString(),
        };

    const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const now = new Date().toISOString();

    const results = await Promise.all(
      batch.map((p) => analyzeOnePair(client, rollupJson, p, meta.zoneFilter, now))
    );

    const newEntries: AiAnalysisEntry[] = [];
    const failures: { pair: Pair; error: string }[] = [];
    let promptTokens = 0;
    let outputTokens = 0;
    for (const r of results) {
      promptTokens += r.promptTokens;
      outputTokens += r.outputTokens;
      if (r.entry) newEntries.push(r.entry);
      else failures.push({ pair: r.pair, error: r.error ?? "unknown" });
    }

    if (newEntries.length > 0) {
      const { analyses: latest, sha: latestSha } = await readAiAnalyses(env);
      const merged = [...latest];
      for (const e of newEntries) {
        const idx = merged.findIndex(
          (m) => m.shortCode === e.shortCode && m.zoneCode === e.zoneCode
        );
        if (idx === -1) merged.push(e);
        else merged[idx] = e;
      }
      merged.sort((a, b) =>
        a.shortCode === b.shortCode
          ? a.zoneCode.localeCompare(b.zoneCode)
          : a.shortCode.localeCompare(b.shortCode)
      );
      const scope = meta.zoneFilter ? ` (zone ${meta.zoneFilter})` : "";
      await writeAiAnalyses(
        env,
        merged,
        latestSha,
        `Add AI analyses${scope}: ${newEntries.length} pair(s) [skip-deploy]`
      );
    }

    meta.succeeded += newEntries.length;
    meta.failed += failures.length;
    meta.promptTokens += promptTokens;
    meta.outputTokens += outputTokens;
    meta.lastTickAt = new Date().toISOString();
    if (remainingAfter.length === 0) meta.finishedAt = meta.lastTickAt;
    await env.ASK_CACHE.put(META_KV_KEY, JSON.stringify(meta), {
      expirationTtl: QUEUE_KV_TTL,
    });

    if (failures.length > 0) {
      console.log(
        `[analyze.tick] ${failures.length} failure(s):`,
        failures.map((f) => `${f.pair.shortCode}|${f.pair.zoneCode}: ${f.error}`).join("; ")
      );
      await env.ASK_CACHE.put(
        FAILED_TEXT_KV_KEY,
        JSON.stringify(failures.map((f) => ({ ...f.pair, error: f.error }))),
        { expirationTtl: QUEUE_KV_TTL }
      ).catch(() => {});
    }

    for (const r of results) {
      console.log(
        `[analyze.tick.diag] ${r.pair.shortCode}|${r.pair.zoneCode} model=${r.diag.modelVersion} finish=${r.diag.finishReason} webQueries=${r.diag.webSearchQueries.length} chunks=${r.diag.groundingChunkCount} webChunks=${r.diag.webChunkCount} supports=${r.diag.groundingSupportCount}`
      );
    }
    await env.ASK_CACHE.put(
      "analyze:last-diag",
      JSON.stringify({ tickAt: new Date().toISOString(), diags: results.map((r) => r.diag) }),
      { expirationTtl: QUEUE_KV_TTL }
    ).catch(() => {});

    return {
      ranTick: true,
      processed: batch.length,
      succeeded: newEntries.length,
      failed: failures.length,
      remaining: remainingAfter.length,
    };
  } finally {
    await env.ASK_CACHE.delete(LOCK_KV_KEY).catch(() => {});
  }
}

export async function clearAnalyzeRun(env: Env): Promise<void> {
  if (!env.ASK_CACHE) return;
  await Promise.all([
    env.ASK_CACHE.delete(QUEUE_KV_KEY),
    env.ASK_CACHE.delete(META_KV_KEY),
    env.ASK_CACHE.delete(LOCK_KV_KEY),
  ]).catch(() => {});
}
