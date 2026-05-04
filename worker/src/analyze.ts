import { GoogleGenAI } from "@google/genai";
import type { AiAnalysisEntry, Env } from "./types";
import { readAiAnalyses, writeAiAnalyses } from "./github";

const ANALYSIS_MODEL = "gemini-3.1-pro-preview";
const MAX_PAIRS_PER_RUN = 80;

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

function buildPrompt(rollupJson: string, pairs: Pair[], zoneFilter: string | null): string {
  const filterNote = zoneFilter
    ? `\nThe user has scoped this run to zone "${zoneFilter}". Still consider neighboring zones and the property as a whole when judging ecological fit — don't restrict your reasoning to that zone.`
    : "";

  const pairList = pairs.map((p) => `- ${p.shortCode} in zone ${p.zoneCode}`).join("\n");

  return `You are analyzing the ecological niche of specimens (plants and animals) observed in a Minneapolis, MN garden journal. The property is on the NW corner of a city block, USDA hardiness zone 4b/5a, clay/loam soil. The owners prioritize native plants, edibles, medicinals, and supporting local ecology.${filterNote}

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

Use the googleSearch tool to ground claims in real sources. In each entry's "references" field, include ONLY URLs you actually retrieved via search. Do not invent URLs. If you have no grounded URL for an entry, return an empty array.

# Pairs to analyze
${pairList}

# Output format
Return ONLY a JSON array — no prose, no markdown fences, no commentary before or after. Each element must be:
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
  // Some models emit a leading sentinel; trim to the first '['.
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
  references?: unknown;
}

function coerceEntries(raw: unknown): RawEntry[] {
  if (!Array.isArray(raw)) throw new Error("Model output was not a JSON array.");
  return raw as RawEntry[];
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

export interface AnalyzeOutcome {
  ok: true;
  analyzed: number;
  totalPairs: number;
  groundingUrls: number;
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
  const { raw: rollupJson, rollup } = await loadRollupParsed(env);

  if (zoneFilter && !rollup.zones.some((z) => z.code === zoneFilter)) {
    return { ok: false, message: `Unknown zone "${zoneFilter}". See /zones.` };
  }

  const { analyses: existing, sha } = await readAiAnalyses(env);
  const pairs = findMissingPairs(rollup, existing, zoneFilter);

  if (pairs.length === 0) {
    return { ok: false, message: zoneFilter
      ? `All plants in zone "${zoneFilter}" already have analyses.`
      : "All specimen+zone pairs already have analyses." };
  }

  if (pairs.length > MAX_PAIRS_PER_RUN) {
    return {
      ok: false,
      message: `Too many missing pairs (${pairs.length}). Re-run with a zone filter, e.g. /analyze fy. Cap is ${MAX_PAIRS_PER_RUN}.`,
    };
  }

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const prompt = buildPrompt(rollupJson, pairs, zoneFilter);

  // googleSearch grounding is incompatible with context caching and structured-output schema
  // on Gemini 3.1 Pro, so we ask for JSON inline and parse it.
  const response = await client.models.generateContent({
    model: ANALYSIS_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const text = (response.candidates?.[0]?.content?.parts ?? [])
    .map((p) => (p as { text?: string }).text ?? "")
    .join("")
    .trim();

  if (!text) return { ok: false, message: "Model returned no text." };

  let parsed: RawEntry[];
  try {
    parsed = coerceEntries(JSON.parse(stripJsonFences(text)));
  } catch (err) {
    return { ok: false, message: `Failed to parse model JSON: ${(err as Error).message}` };
  }

  const groundedUrls = collectGroundingUrls(response);
  const requested = new Set(pairs.map((p) => `${p.shortCode}|${p.zoneCode}`));
  const now = new Date().toISOString();

  const newEntries: AiAnalysisEntry[] = [];
  for (const e of parsed) {
    const shortCode = typeof e.shortCode === "string" ? e.shortCode : null;
    const zoneCode = typeof e.zoneCode === "string" ? e.zoneCode : null;
    const analysis = typeof e.analysis === "string" ? e.analysis.trim() : "";
    if (!shortCode || !zoneCode || !analysis) continue;
    if (!requested.has(`${shortCode}|${zoneCode}`)) continue;

    const rawRefs = Array.isArray(e.references) ? e.references : [];
    const references = rawRefs
      .filter((r): r is string => typeof r === "string" && r.startsWith("http"))
      .filter((r) => groundedUrls.has(r));

    newEntries.push({ shortCode, zoneCode, analysis, references, created: now });
  }

  if (newEntries.length === 0) {
    return { ok: false, message: "Model produced no usable entries." };
  }

  const merged = [...existing];
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
    sha,
    `Add AI analyses${scope}: ${newEntries.length} pair(s) [skip-deploy]`
  );

  const meta = response.usageMetadata;
  return {
    ok: true,
    analyzed: newEntries.length,
    totalPairs: pairs.length,
    groundingUrls: groundedUrls.size,
    promptTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
  };
}
