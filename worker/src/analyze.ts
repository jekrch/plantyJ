import { GoogleGenAI } from "@google/genai";
import type { AiAnalysisEntry, Env } from "./types";
import { readAiAnalyses, writeAiAnalyses } from "./github";

const ANALYSIS_MODEL = "gemini-3.1-pro-preview";
const JOB_KV_KEY = "analyze:job";
const FAILED_TEXT_KV_KEY = "analyze:last-failed-text";
// 7 days — Gemini's Batch API SLA is up to ~72h, and the result file is
// retained on Google's side for a while after that, so giving ourselves a
// week of slack means we'll never lose a job pointer to KV expiry.
const JOB_KV_TTL = 7 * 86400;
// One Gemini batch request per chunk. Smaller chunks keep each response
// inside the model's max-output-tokens budget so they don't get truncated
// mid-array. The whole job still fans out in parallel on Google's side.
const PAIRS_PER_CHUNK = 15;

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

interface PendingJob {
  name: string;
  zoneFilter: string | null;
  pairCount: number;
  submittedAt: string;
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

function buildBatchPrompt(
  rollupJson: string,
  pairs: Pair[],
  zoneFilter: string | null
): string {
  const filterNote = zoneFilter
    ? `\nThis run is scoped to zone "${zoneFilter}". Still consider neighboring zones and the property as a whole when judging ecological fit — don't restrict reasoning to that zone.`
    : "";

  const pairList = pairs.map((p) => `- ${p.shortCode} in zone ${p.zoneCode}`).join("\n");

  return `You are analyzing the ecological niche of specimens (plants and animals) observed in a Minneapolis, MN garden journal. The property is on the NW corner of a city block, USDA hardiness zone 4b/5a, clay/loam soil. Owners prioritize native plants, edibles, medicinals, and supporting local ecology.${filterNote}

# Garden context (full rollup)
# Schema: zones[]: {code, name}; plants[]: {shortCode, fullName, commonName, tags, byZone, pics, zonesSeen, kind?, ...}
# "kind" may be "plant" or "animal"; if absent, treat as plant.
${rollupJson}

# Task
For EACH of the ${pairs.length} specimen + zone pairs below, write a 1–2 paragraph analysis. State the verdict (GOOD / BAD / MIXED) explicitly in the first sentence.

For PLANTS, cover:
- Whether the ecological niche is GOOD, BAD, or MIXED for that zone (factor in zone neighbors but don't restrict to them)
- Native insects served (pollinators, specialists, host relationships) and urban wildlife (birds, mammals)
- Practical concerns for this property (clay/loam, zone 4b/5a, native-priority owners)

For ANIMALS, cover:
- Whether the species' presence in that zone is GOOD, BAD, or MIXED for the garden's ecology and the owners' priorities
- What it eats, predates, pollinates, or competes with — given the plants currently in that zone and its neighbors
- Whether it is native, naturalized, or invasive in the Twin Cities area, and any management considerations

Use the googleSearch tool to ground claims in real sources. In each entry's "references", include ONLY URLs you actually retrieved via search. Do not invent URLs — if you have no grounded URL for an entry, return an empty array.

# Pairs to analyze
${pairList}

# Output format
Return ONLY a JSON array — no prose, no markdown fences, no commentary before or after. Each element must be exactly:
{
  "shortCode": string,
  "zoneCode": string,
  "analysis": string,
  "references": string[]
}
Output exactly one object per pair, in the same order as listed above. Begin your response with [ and end it with ].`;
}

function stripJsonFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  const firstBracket = t.indexOf("[");
  const lastBracket = t.lastIndexOf("]");
  if (firstBracket > 0 && lastBracket > firstBracket) {
    t = t.slice(firstBracket, lastBracket + 1);
  }
  return t;
}

// Walk a possibly-truncated JSON array and pull out every complete top-level
// object. Used when the model hits max-output-tokens mid-array and JSON.parse
// chokes on the unterminated tail.
function salvageJsonObjects(text: string): unknown[] {
  const start = text.indexOf("[");
  if (start === -1) return [];
  const out: unknown[] = [];
  let i = start + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length || text[i] === "]") break;
    if (text[i] !== "{") break;
    let depth = 0;
    let inStr = false;
    let escape = false;
    let j = i;
    let closed = false;
    for (; j < text.length; j++) {
      const c = text[j];
      if (escape) { escape = false; continue; }
      if (inStr) {
        if (c === "\\") escape = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { j++; closed = true; break; }
      }
    }
    if (!closed) break;
    try {
      out.push(JSON.parse(text.slice(i, j)));
    } catch {
      break;
    }
    i = j;
  }
  return out;
}

interface ParseResult {
  objects: unknown[] | null;
  salvaged: boolean;
  reason: string;
}

function parseOrSalvage(text: string): ParseResult {
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return { objects: v, salvaged: false, reason: "" };
    return { objects: null, salvaged: false, reason: "model output was not a JSON array" };
  } catch (err) {
    const salvage = salvageJsonObjects(text);
    if (salvage.length > 0) {
      return { objects: salvage, salvaged: true, reason: (err as Error).message };
    }
    return { objects: null, salvaged: false, reason: `parse failed: ${(err as Error).message}` };
  }
}

function chunkPairs(pairs: Pair[], size: number): Pair[][] {
  const out: Pair[][] = [];
  for (let i = 0; i < pairs.length; i += size) out.push(pairs.slice(i, i + size));
  return out;
}

interface RawEntry {
  shortCode?: unknown;
  zoneCode?: unknown;
  analysis?: unknown;
  references?: unknown;
}

function normalizeEntry(
  e: RawEntry,
  groundedUrls: Set<string>,
  now: string
): AiAnalysisEntry | null {
  const shortCode = typeof e.shortCode === "string" ? e.shortCode : null;
  const zoneCode = typeof e.zoneCode === "string" ? e.zoneCode : null;
  const analysis = typeof e.analysis === "string" ? e.analysis.trim() : "";
  if (!shortCode || !zoneCode || !analysis) return null;
  const rawRefs = Array.isArray(e.references) ? e.references : [];
  const references = rawRefs
    .filter((r): r is string => typeof r === "string" && r.startsWith("http"))
    .filter((r) => groundedUrls.has(r));
  return { shortCode, zoneCode, analysis, references, created: now };
}

function collectGroundingUrls(response: unknown): Set<string> {
  const urls = new Set<string>();
  const candidates = (response as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> } }> })?.candidates;
  const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const c of chunks) {
    const uri = c?.web?.uri;
    if (typeof uri === "string" && uri.startsWith("http")) urls.add(uri);
  }
  return urls;
}

function elapsedSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export interface SubmitOk {
  ok: true;
  jobName: string;
  pairCount: number;
}
export interface SubmitErr {
  ok: false;
  message: string;
}

export async function submitAnalyzeBatch(
  env: Env,
  zoneFilter: string | null
): Promise<SubmitOk | SubmitErr> {
  console.log(`[analyze.submit] start, zoneFilter=${zoneFilter ?? "(none)"}`);

  if (!env.ASK_CACHE) {
    return { ok: false, message: "KV not configured — batch tracking requires ASK_CACHE." };
  }

  const existingRaw = await env.ASK_CACHE.get(JOB_KV_KEY);
  if (existingRaw) {
    const job: PendingJob = JSON.parse(existingRaw);
    return {
      ok: false,
      message: `A batch job is already pending (submitted ${elapsedSince(job.submittedAt)} ago, ${job.pairCount} pair(s)). Run /analyze-load to check or fetch it before starting another.`,
    };
  }

  const { raw: rollupJson, rollup } = await loadRollupParsed(env);
  if (zoneFilter && !rollup.zones.some((z) => z.code === zoneFilter)) {
    return { ok: false, message: `Unknown zone "${zoneFilter}". See /zones.` };
  }

  const { analyses: existing } = await readAiAnalyses(env);
  const pairs = findMissingPairs(rollup, existing, zoneFilter);
  console.log(`[analyze.submit] ${pairs.length} pair(s) missing analyses`);

  if (pairs.length === 0) {
    return {
      ok: false,
      message: zoneFilter
        ? `All plants in zone "${zoneFilter}" already have analyses.`
        : "All specimen+zone pairs already have analyses.",
    };
  }

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const chunks = chunkPairs(pairs, PAIRS_PER_CHUNK);
  const src = chunks.map((chunk) => ({
    contents: [
      { role: "user", parts: [{ text: buildBatchPrompt(rollupJson, chunk, zoneFilter) }] },
    ],
    config: {
      tools: [{ googleSearch: {} }],
    },
  }));

  console.log(
    `[analyze.submit] creating batch, ${chunks.length} chunk(s) of ≤${PAIRS_PER_CHUNK}, pairs=${pairs.length}`
  );
  let job;
  try {
    job = await client.batches.create({
      model: ANALYSIS_MODEL,
      src,
      config: {
        displayName: `plantyj-analyze-${zoneFilter ?? "all"}-${Date.now()}`,
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.log(`[analyze.submit] batch create failed: ${msg}`);
    return { ok: false, message: `Batch submit failed: ${msg}` };
  }

  if (!job.name) {
    return { ok: false, message: "Batch created but returned no job name." };
  }
  console.log(`[analyze.submit] created job ${job.name}, state=${job.state}`);

  const pending: PendingJob = {
    name: job.name,
    zoneFilter,
    pairCount: pairs.length,
    submittedAt: new Date().toISOString(),
  };
  await env.ASK_CACHE.put(JOB_KV_KEY, JSON.stringify(pending), { expirationTtl: JOB_KV_TTL });

  return { ok: true, jobName: job.name, pairCount: pairs.length };
}

export type LoadResult =
  | { kind: "no-job" }
  | { kind: "running"; state: string; pairCount: number; elapsed: string }
  | { kind: "failed"; reason: string; rawTextSaved?: boolean }
  | {
      kind: "done";
      analyzed: number;
      requested: number;
      groundingUrls: number;
      promptTokens: number;
      outputTokens: number;
      truncatedChunks: number;
      failedChunks: number;
      totalChunks: number;
    };

export async function loadAnalyzeBatch(env: Env): Promise<LoadResult> {
  if (!env.ASK_CACHE) {
    return { kind: "failed", reason: "KV not configured." };
  }

  const raw = await env.ASK_CACHE.get(JOB_KV_KEY);
  if (!raw) return { kind: "no-job" };

  const pending: PendingJob = JSON.parse(raw);
  console.log(`[analyze.load] checking job ${pending.name}`);

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  let job;
  try {
    job = await client.batches.get({ name: pending.name });
  } catch (err) {
    const msg = (err as Error).message;
    console.log(`[analyze.load] batches.get failed: ${msg}`);
    return { kind: "failed", reason: `batches.get error: ${msg}` };
  }

  const state = job.state ?? "JOB_STATE_UNSPECIFIED";
  console.log(`[analyze.load] state=${state}`);

  if (
    state === "JOB_STATE_PENDING" ||
    state === "JOB_STATE_QUEUED" ||
    state === "JOB_STATE_RUNNING" ||
    state === "JOB_STATE_UPDATING"
  ) {
    return {
      kind: "running",
      state,
      pairCount: pending.pairCount,
      elapsed: elapsedSince(pending.submittedAt),
    };
  }

  if (
    state === "JOB_STATE_FAILED" ||
    state === "JOB_STATE_CANCELLED" ||
    state === "JOB_STATE_CANCELLING" ||
    state === "JOB_STATE_EXPIRED"
  ) {
    const reason = job.error?.message ?? state;
    await env.ASK_CACHE.delete(JOB_KV_KEY).catch(() => {});
    return { kind: "failed", reason };
  }

  // SUCCEEDED or PARTIALLY_SUCCEEDED — pull responses and commit.
  const inlined = job.dest?.inlinedResponses ?? [];
  if (inlined.length === 0) {
    return { kind: "failed", reason: `Job ${state} but no inlinedResponses returned.` };
  }

  const now = new Date().toISOString();
  const newEntries: AiAnalysisEntry[] = [];
  const allGroundedUrls = new Set<string>();
  let promptTokens = 0;
  let outputTokens = 0;
  let truncatedChunks = 0;
  let failedChunks = 0;
  const debugChunks: { idx: number; reason?: string; text?: string }[] = [];

  for (let i = 0; i < inlined.length; i++) {
    const item = inlined[i];
    if (item.error) {
      failedChunks++;
      debugChunks.push({ idx: i, reason: `inlined error: ${item.error.message ?? "unknown"}` });
      console.log(`[analyze.load] chunk ${i} errored: ${item.error.message ?? "unknown"}`);
      continue;
    }
    const response = item.response;
    const text = (response?.candidates?.[0]?.content?.parts ?? [])
      .map((p) => (p as { text?: string }).text ?? "")
      .join("")
      .trim();

    const meta = response?.usageMetadata;
    promptTokens += meta?.promptTokenCount ?? 0;
    outputTokens += meta?.candidatesTokenCount ?? 0;

    const groundedUrls = collectGroundingUrls(response);
    for (const u of groundedUrls) allGroundedUrls.add(u);

    if (!text) {
      failedChunks++;
      debugChunks.push({ idx: i, reason: "no text in response" });
      continue;
    }

    const parsed = parseOrSalvage(stripJsonFences(text));
    if (!parsed.objects) {
      failedChunks++;
      debugChunks.push({ idx: i, reason: parsed.reason, text });
      console.log(`[analyze.load] chunk ${i} parse failed: ${parsed.reason}`);
      continue;
    }
    if (parsed.salvaged) {
      truncatedChunks++;
      console.log(
        `[analyze.load] chunk ${i} truncated, salvaged ${parsed.objects.length} object(s): ${parsed.reason}`
      );
    }

    for (const e of parsed.objects as RawEntry[]) {
      const entry = normalizeEntry(e, groundedUrls, now);
      if (entry) newEntries.push(entry);
    }
  }

  if (newEntries.length === 0) {
    // Nothing usable came back. Stash the raw text under a debug key (kept for
    // the same TTL as the job pointer) and leave the job pointer in place so
    // the user can retry /analyze-load or inspect the response.
    let saved = false;
    try {
      await env.ASK_CACHE.put(FAILED_TEXT_KV_KEY, JSON.stringify(debugChunks), {
        expirationTtl: JOB_KV_TTL,
      });
      saved = true;
    } catch (err) {
      console.log(`[analyze.load] failed to stash debug text: ${(err as Error).message}`);
    }
    return {
      kind: "failed",
      reason: `Model produced no usable entries (${failedChunks}/${inlined.length} chunks unparseable).`,
      rawTextSaved: saved,
    };
  }

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

  const scope = pending.zoneFilter ? ` (zone ${pending.zoneFilter})` : "";
  await writeAiAnalyses(
    env,
    merged,
    latestSha,
    `Add AI analyses${scope}: ${newEntries.length} pair(s) [skip-deploy]`
  );
  console.log(
    `[analyze.load] committed ${newEntries.length} entries (truncated=${truncatedChunks}, failed=${failedChunks}/${inlined.length})`
  );

  await env.ASK_CACHE.delete(JOB_KV_KEY).catch(() => {});
  if (failedChunks > 0 || truncatedChunks > 0) {
    await env.ASK_CACHE.put(FAILED_TEXT_KV_KEY, JSON.stringify(debugChunks), {
      expirationTtl: JOB_KV_TTL,
    }).catch(() => {});
  } else {
    await env.ASK_CACHE.delete(FAILED_TEXT_KV_KEY).catch(() => {});
  }

  return {
    kind: "done",
    analyzed: newEntries.length,
    requested: pending.pairCount,
    groundingUrls: allGroundedUrls.size,
    promptTokens,
    outputTokens,
    truncatedChunks,
    failedChunks,
    totalChunks: inlined.length,
  };
}

export interface AttachOk {
  ok: true;
  jobName: string;
}
export interface AttachErr {
  ok: false;
  message: string;
}

export async function attachAnalyzeBatch(
  env: Env,
  jobName: string
): Promise<AttachOk | AttachErr> {
  if (!env.ASK_CACHE) {
    return { ok: false, message: "KV not configured." };
  }
  if (!jobName.startsWith("batches/")) {
    return { ok: false, message: `Job name must start with "batches/" — got "${jobName}".` };
  }

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  let job;
  try {
    job = await client.batches.get({ name: jobName });
  } catch (err) {
    return { ok: false, message: `batches.get failed: ${(err as Error).message}` };
  }

  const inlined = job.dest?.inlinedResponses ?? [];
  const pairCount = inlined.length * PAIRS_PER_CHUNK;
  const pending: PendingJob = {
    name: jobName,
    zoneFilter: null,
    pairCount,
    submittedAt: new Date().toISOString(),
  };
  await env.ASK_CACHE.put(JOB_KV_KEY, JSON.stringify(pending), { expirationTtl: JOB_KV_TTL });
  return { ok: true, jobName };
}
