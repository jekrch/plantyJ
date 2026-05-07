import { GoogleGenAI } from "@google/genai";
import type { AiAnalysisEntry, AiVerdict, Env } from "./types";
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
const PAIRS_PER_CHUNK = 25;

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
For EACH of the ${pairs.length} specimen + zone pairs below, decide a verdict (GOOD / BAD / MIXED) and write a 1–2 paragraph analysis. The verdict goes in its own "verdict" field — do NOT repeat it as a prefix in the analysis prose.

For PLANTS, cover:
- Whether the ecological niche is GOOD, BAD, or MIXED for that zone (factor in zone neighbors but don't restrict to them)
- Native insects served (pollinators, specialists, host relationships) and urban wildlife (birds, mammals)
- Practical concerns for this property (clay/loam, zone 4b/5a, native-priority owners)

For ANIMALS, cover:
- Whether the species' presence in that zone is GOOD, BAD, or MIXED for the garden's ecology and the owners' priorities
- What it eats, predates, pollinates, or competes with — given the plants currently in that zone and its neighbors
- Whether it is native, naturalized, or invasive in the Twin Cities area, and any management considerations

Use the googleSearch tool to ground claims in real sources. Do NOT include inline citation markers (e.g. [1], [1.3], [2, 3]) anywhere in the analysis prose — references are collected automatically from the grounding metadata, and inline markers corrupt the prose's spacing.

# Pairs to analyze
${pairList}

# Output format
Return ONLY a JSON array — no prose, no markdown fences, no commentary before or after. Each element must be exactly:
{
  "shortCode": string,
  "zoneCode": string,
  "verdict": "GOOD" | "BAD" | "MIXED",
  "analysis": string
}
The "analysis" string should NOT begin with "GOOD." / "BAD." / "MIXED." — that information lives in "verdict". Output exactly one object per pair, in the same order as listed above. Begin your response with [ and end it with ].`;
}

interface ObjectWithBounds {
  object: unknown;
  startIndex: number;
  endIndex: number;
}

// Scans the raw text to extract top-level JSON objects from an array, mapping
// their start/end indices. By running this against the RAW model output (including
// markdown fences), we preserve the character offsets needed to map Gemini's
// groundingSupports reliably.
function extractJsonObjectsWithBounds(text: string): ObjectWithBounds[] {
  const start = text.indexOf("[");
  if (start === -1) return [];
  const out: ObjectWithBounds[] = [];
  let i = start + 1;
  
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length || text[i] === "]") break;
    
    if (text[i] !== "{") {
      // Unexpected char, advance to next '{' or ']'
      while (i < text.length && text[i] !== "{" && text[i] !== "]") i++;
      if (i >= text.length || text[i] === "]") break;
    }
    
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
      out.push({ object: JSON.parse(text.slice(i, j)), startIndex: i, endIndex: j });
    } catch {
      break;
    }
    i = j;
  }
  return out;
}

interface ParseResult {
  objects: ObjectWithBounds[] | null;
  salvaged: boolean;
  reason: string;
}

function parseOrSalvage(text: string): ParseResult {
  const extracted = extractJsonObjectsWithBounds(text);
  if (extracted.length === 0) {
    return { objects: null, salvaged: false, reason: "Model output contained no valid JSON objects" };
  }
  
  // Basic heuristic: if the text following the last object doesn't close the array, it was likely truncated.
  const lastObjEnd = extracted[extracted.length - 1].endIndex;
  const tail = text.slice(lastObjEnd).trim();
  const salvaged = !tail.includes("]");

  return { objects: extracted, salvaged, reason: salvaged ? "Array truncated mid-output" : "" };
}

function chunkPairs(pairs: Pair[], size: number): Pair[][] {
  const out: Pair[][] = [];
  for (let i = 0; i < pairs.length; i += size) out.push(pairs.slice(i, i + size));
  return out;
}

interface RawEntry {
  shortCode?: unknown;
  zoneCode?: unknown;
  verdict?: unknown;
  analysis?: unknown;
  // Internal field used during Phase 1 & 2 to attach un-resolved redirect URLs
  _rawGroundingUrls?: string[];
}

// Strips inline citation markers like [1], [1.3], [2, 3] that the model
// occasionally emits despite being told not to. Also collapses runs of
// internal whitespace that the marker may have left behind.
function stripInlineCitations(text: string): string {
  return text.replace(/\s*\[\d+(?:[.,]\s*\d+)*\]/g, "").replace(/[ \t]{2,}/g, " ");
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

async function resolveRedirects(
  urls: string[],
  concurrency = 20
): Promise<Map<string, string>> {
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

// Pulls a leading "GOOD." / "BAD." / "MIXED." off the analysis prose so older
// model behavior (which embedded the verdict in the first sentence) doesn't
// double up with the new dedicated field. Returns the verdict if found.
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

function normalizeEntry(
  e: RawEntry,
  references: string[],
  now: string
): AiAnalysisEntry | null {
  const shortCode = typeof e.shortCode === "string" ? e.shortCode : null;
  const zoneCode = typeof e.zoneCode === "string" ? e.zoneCode : null;
  const rawAnalysis = typeof e.analysis === "string" ? e.analysis.trim() : "";
  if (!shortCode || !zoneCode || !rawAnalysis) return null;

  const stripped = extractLeadingVerdict(rawAnalysis);
  const verdict = coerceVerdict(e.verdict) ?? stripped.verdict;
  if (!verdict) return null;
  const analysis = stripInlineCitations(stripped.rest).trim();
  if (!analysis) return null;

  return { shortCode, zoneCode, verdict, analysis, references, created: now };
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

  // Phase 1: parse every chunk against the unstripped string to maintain
  // exact grounding offset alignment. Attach relevant URLs to each RawEntry.
  const parsedChunks: { idx: number; objects: RawEntry[] }[] = [];

  for (let i = 0; i < inlined.length; i++) {
    const item = inlined[i];
    if (item.error) {
      failedChunks++;
      debugChunks.push({ idx: i, reason: `inlined error: ${item.error.message ?? "unknown"}` });
      console.log(`[analyze.load] chunk ${i} errored: ${item.error.message ?? "unknown"}`);
      continue;
    }
    const response = item.response;
    // Extract raw text. DO NOT trim/strip this before passing to the parser,
    // otherwise the text length shifts and breaks the grounding support mapping.
    const text = (response?.candidates?.[0]?.content?.parts ?? [])
      .map((p) => (p as { text?: string }).text ?? "")
      .join("");

    const usageMeta = response?.usageMetadata;
    promptTokens += usageMeta?.promptTokenCount ?? 0;
    outputTokens += usageMeta?.candidatesTokenCount ?? 0;

    const groundingMeta = response?.candidates?.[0]?.groundingMetadata;
    const groundingChunks = groundingMeta?.groundingChunks ?? [];
    const groundingSupports = groundingMeta?.groundingSupports ?? [];

    if (!text.trim()) {
      failedChunks++;
      debugChunks.push({ idx: i, reason: "no text in response" });
      continue;
    }

    const parsed = parseOrSalvage(text);
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

    const rawEntries: RawEntry[] = [];

    // Gemini's grounding segment indices are UTF-8 byte offsets within the
    // part, but extractJsonObjectsWithBounds returns JS character (UTF-16)
    // offsets. Convert object bounds to bytes so comparisons line up — any
    // multi-byte char in the prose (em-dashes, etc.) silently breaks the
    // overlap check otherwise.
    const enc = new TextEncoder();
    let walkChar = 0;
    let walkByte = 0;
    const objectBounds = parsed.objects.map((item) => {
      walkByte += enc.encode(text.slice(walkChar, item.startIndex)).length;
      walkChar = item.startIndex;
      const startByte = walkByte;
      walkByte += enc.encode(text.slice(walkChar, item.endIndex)).length;
      walkChar = item.endIndex;
      return { obj: item, startByte, endByte: walkByte };
    });

    // Map grounding chunks to the specific JSON object they apply to
    for (const { obj, startByte, endByte } of objectBounds) {
      const entryUrls = new Set<string>();
      const rawObj = obj.object as RawEntry;

      for (const support of groundingSupports) {
        // Byte offsets are relative to a specific part. We joined parts into
        // one string above, so only part 0 lines up with our walkByte math.
        // In practice batch responses are a single text part.
        if ((support.segment?.partIndex ?? 0) !== 0) continue;

        const start = support.segment?.startIndex ?? 0;
        const end = support.segment?.endIndex ?? 0;

        // Check if the grounded text occurs *inside* this specific JSON object's byte bounds
        if (start >= startByte && end <= endByte) {
          for (const chunkIdx of support.groundingChunkIndices ?? []) {
            const uri = groundingChunks[chunkIdx]?.web?.uri;
            if (typeof uri === "string" && uri.startsWith("http")) {
              entryUrls.add(uri);
              allGroundedUrls.add(uri);
            }
          }
        }
      }

      rawObj._rawGroundingUrls = Array.from(entryUrls);
      rawEntries.push(rawObj);
    }

    parsedChunks.push({ idx: i, objects: rawEntries });
  }

  // Phase 2: resolve all unique grounding redirects globally.
  const uniqueRedirects = Array.from(allGroundedUrls);
  console.log(`[analyze.load] resolving ${uniqueRedirects.length} grounding redirect(s)`);
  const resolved = await resolveRedirects(uniqueRedirects, 20);

  // Phase 3: normalize entries. Because Phase 1 already handled the complex text 
  // alignment, we just look up the resolved versions of the assigned URLs here.
  for (const c of parsedChunks) {
    for (const e of c.objects) {
      const refs = (e._rawGroundingUrls ?? []).map((u) => resolved.get(u) ?? u);
      const entry = normalizeEntry(e, refs, now);
      if (entry) newEntries.push(entry);
    }
  }

  if (newEntries.length === 0) {
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
