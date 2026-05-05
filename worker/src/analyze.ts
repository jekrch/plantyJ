import { GoogleGenAI } from "@google/genai";
import type { AiAnalysisEntry, Env } from "./types";
import { readAiAnalyses, writeAiAnalyses } from "./github";

const ANALYSIS_MODEL = "gemini-3.1-pro-preview";
// One Gemini call covers up to this many pairs per /analyze invocation.
// Cap exists so the call always finishes inside the Worker's wall budget.
// If more pairs are missing, the run does this many, commits, and reports
// remaining count — the user re-runs /analyze to continue.
const MAX_PAIRS_PER_CALL = 15;

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

# Pairs to analyze
${pairList}

# Output format
Return ONLY a JSON array — no prose, no markdown fences, no commentary before or after. Each element must be exactly:
{
  "shortCode": string,
  "zoneCode": string,
  "analysis": string
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

interface RawEntry {
  shortCode?: unknown;
  zoneCode?: unknown;
  analysis?: unknown;
}

export interface AnalyzeOutcome {
  ok: true;
  analyzed: number;
  totalPairs: number;
  batchSize: number;
  remaining: number;
  promptTokens: number;
  outputTokens: number;
}

export interface AnalyzeError {
  ok: false;
  message: string;
}

export async function runAnalyze(
  env: Env,
  zoneFilter: string | null
): Promise<AnalyzeOutcome | AnalyzeError> {
  const t0 = Date.now();
  console.log(`[analyze] start, zoneFilter=${zoneFilter ?? "(none)"}`);

  const { raw: rollupJson, rollup } = await loadRollupParsed(env);
  console.log(`[analyze] loaded rollup (${rollupJson.length} bytes)`);

  if (zoneFilter && !rollup.zones.some((z) => z.code === zoneFilter)) {
    return { ok: false, message: `Unknown zone "${zoneFilter}". See /zones.` };
  }

  const initial = await readAiAnalyses(env);
  const allPairs = findMissingPairs(rollup, initial.analyses, zoneFilter);
  console.log(`[analyze] ${allPairs.length} pair(s) missing analyses`);

  if (allPairs.length === 0) {
    return {
      ok: false,
      message: zoneFilter
        ? `All plants in zone "${zoneFilter}" already have analyses.`
        : "All specimen+zone pairs already have analyses.",
    };
  }

  const batch = allPairs.slice(0, MAX_PAIRS_PER_CALL);
  const remaining = allPairs.length - batch.length;
  console.log(`[analyze] processing ${batch.length} pair(s) this call, ${remaining} deferred`);

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  let response;
  try {
    response = await client.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: [{ role: "user", parts: [{ text: buildBatchPrompt(rollupJson, batch, zoneFilter) }] }],
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.log(`[analyze] gemini error: ${msg}`);
    return { ok: false, message: `Gemini call failed: ${msg}` };
  }
  console.log(`[analyze] gemini returned in ${Date.now() - t0}ms`);

  const meta = response.usageMetadata;
  const promptTokens = meta?.promptTokenCount ?? 0;
  const outputTokens = meta?.candidatesTokenCount ?? 0;

  const text = (response.candidates?.[0]?.content?.parts ?? [])
    .map((p) => (p as { text?: string }).text ?? "")
    .join("")
    .trim();

  if (!text) {
    return { ok: false, message: "Model returned no text." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch (err) {
    console.log(`[analyze] parse error: ${(err as Error).message}; head=${text.slice(0, 200)}`);
    return { ok: false, message: `Failed to parse model JSON: ${(err as Error).message}` };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, message: "Model output was not a JSON array." };
  }

  const requested = new Set(batch.map((p) => `${p.shortCode}|${p.zoneCode}`));
  const now = new Date().toISOString();

  const newEntries: AiAnalysisEntry[] = [];
  for (const e of parsed as RawEntry[]) {
    const shortCode = typeof e.shortCode === "string" ? e.shortCode : null;
    const zoneCode = typeof e.zoneCode === "string" ? e.zoneCode : null;
    const analysis = typeof e.analysis === "string" ? e.analysis.trim() : "";
    if (!shortCode || !zoneCode || !analysis) continue;
    if (!requested.has(`${shortCode}|${zoneCode}`)) continue;
    newEntries.push({ shortCode, zoneCode, analysis, references: [], created: now });
  }
  console.log(`[analyze] usable entries: ${newEntries.length}/${batch.length}`);

  if (newEntries.length === 0) {
    return { ok: false, message: "Model produced no usable entries." };
  }

  // Re-read just before write so we commit on top of the latest sha (in case
  // a parallel run or upstream commit landed during the Gemini call).
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

  const scope = zoneFilter ? ` (zone ${zoneFilter})` : "";
  await writeAiAnalyses(
    env,
    merged,
    latestSha,
    `Add AI analyses${scope}: ${newEntries.length} pair(s) [skip-deploy]`
  );
  console.log(`[analyze] committed ${newEntries.length} entries to GitHub`);

  return {
    ok: true,
    analyzed: newEntries.length,
    totalPairs: allPairs.length,
    batchSize: batch.length,
    remaining: remaining + (batch.length - newEntries.length),
    promptTokens,
    outputTokens,
  };
}
