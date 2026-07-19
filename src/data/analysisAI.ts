import type { AIAnalysis, AIVerdict } from "../types";
import type { GardenRollup } from "./relationshipAI";

/**
 * Client-side "AI assist" for drafting ecological analyses. The browser
 * counterpart of the Telegram worker's `/analyze` flow
 * ([worker/src/analyze.ts]): it composes a self-contained prompt — the garden
 * **rollup** plus the gardener's own property description — that the user pastes
 * into any chat model. The model replies with a JSON array of analyses (one per
 * requested specimen+zone pair), which `parseAnalysisResponse` turns back into
 * `AIAnalysis` records for `applyAnalyses` to persist to `ai_analysis.json`.
 *
 * Unlike the relationship builder (which uses a `/relate` slash-command
 * grammar), analyses are multi-paragraph prose, so the reply contract is a JSON
 * array — the same envelope shape the worker asks Gemini for. Only two pairs are
 * requested per prompt so the user reviews a small, digestible batch at a time.
 *
 * The rollup itself is shared with the relationship builder (`buildRollup` in
 * relationshipAI.ts): its `zones[]` carry descriptions and its `plants[]` carry
 * `zonesSeen`, which is exactly what analyses need.
 */

export interface AnalysisPair {
  shortCode: string;
  zoneCode: string;
}

/** `shortCode|zoneCode` — the stable key used to dedupe analyses. */
export function pairKey(shortCode: string, zoneCode: string): string {
  return `${shortCode}|${zoneCode}`;
}

/**
 * Every specimen+zone pair present in the rollup that doesn't yet have an
 * analysis. Mirrors `findMissingPairs` in the worker: iterate each plant's
 * `zonesSeen`, skipping pairs already in `existing`. Sorted for a stable order
 * so the "next 2" the UI defaults to is deterministic.
 */
export function findMissingAnalysisPairs(
  rollup: GardenRollup,
  existing: AIAnalysis[],
): AnalysisPair[] {
  const have = new Set(existing.map((e) => pairKey(e.shortCode, e.zoneCode)));
  const out: AnalysisPair[] = [];
  for (const p of rollup.plants) {
    for (const z of p.zonesSeen) {
      if (!have.has(pairKey(p.shortCode, z))) out.push({ shortCode: p.shortCode, zoneCode: z });
    }
  }
  out.sort((a, b) =>
    a.shortCode === b.shortCode
      ? a.zoneCode.localeCompare(b.zoneCode)
      : a.shortCode.localeCompare(b.shortCode),
  );
  return out;
}

export interface AnalysisPromptOptions {
  pairs: AnalysisPair[];
  /** 1 or 2 — how many paragraphs of prose per specimen. */
  paragraphs: 1 | 2;
  /** The gardener's saved location/property description, or null for none. */
  gardenDescription: string | null;
}

/**
 * Compose the model prompt: property context + task framing + JSON output
 * contract + the rollup JSON. The reply is parsed by `parseAnalysisResponse`,
 * so the output contract (a fenced JSON array, no prose) matters.
 */
export function buildAnalysisPrompt(rollup: GardenRollup, opts: AnalysisPromptOptions): string {
  const { pairs, paragraphs, gardenDescription } = opts;
  const rollupJson = JSON.stringify(rollup);
  const paraWord = paragraphs === 1 ? "1 paragraph" : "2 paragraphs";

  const property = gardenDescription?.trim()
    ? `# The garden (location & property conditions, from the gardener)
${gardenDescription.trim()}`
    : `# The garden (location & property conditions)
The gardener hasn't described their site yet, so location, hardiness zone, soil, and priorities are unspecified. Reason from the organisms and zones in the rollup, keep claims appropriately general, and note where a site detail would change the verdict.`;

  const pairList = pairs.map((p) => `- ${p.shortCode} // ${p.zoneCode}`).join("\n");

  return `You are a garden-ecology assistant analyzing the ecological niche of specific specimens (plants or animals) in a personal garden journal. Below is a JSON "rollup" of the garden — its plants and animals (each with a \`shortCode\` id, names, tags, and the zones where it was seen) and its zones (each with an optional description).

${property}

# Task
Write an analysis for **exactly these ${pairs.length} specimen+zone pair(s)** — no more, no fewer. Use the \`shortCode\` and \`zoneCode\` verbatim; do not invent, rename, or abbreviate them, and do not analyze any pair not listed here:
${pairList}

For each pair, decide a verdict — GOOD, BAD, or MIXED — for how well that specimen's ecological niche fits that zone (factor in neighboring zones and the property as a whole, don't restrict reasoning to the one zone), then write ${paraWord} of analysis. For PLANTS cover the niche fit, native insects/wildlife served, and practical concerns for this property. For ANIMALS cover whether its presence is good for the garden's ecology, what it eats/predates/pollinates/competes with given the nearby plants, and whether it's native, naturalized, or invasive.

# Output contract (read carefully)
Reply with **only** a single fenced \`\`\`json code block containing a JSON array — no prose, no commentary before or after. Each array element is an object:
{
  "shortCode": string,   // copied verbatim from the pair list
  "zoneCode": string,    // copied verbatim from the pair list
  "verdict": "GOOD" | "BAD" | "MIXED",
  "analysis": string,    // ${paraWord}; do NOT begin with "GOOD."/"BAD."/"MIXED." — the verdict lives in its own field
  "references": string[] // URLs of real sources you used; [] if none. Never invent URLs.
}

Rules:
- Return exactly one object per requested pair, in the same order.
- The verdict goes only in the "verdict" field — never as a prefix in the prose.
- Do NOT include inline citation markers (e.g. [1], [2, 3]) in the analysis — they corrupt spacing. Put sources in "references".

## Example output
\`\`\`json
[
  {
    "shortCode": "borage",
    "zoneCode": "A",
    "verdict": "GOOD",
    "analysis": "Borage is a strong nectar source that draws honeybees and native bumblebees throughout the season...",
    "references": ["https://en.wikipedia.org/wiki/Borage"]
  }
]
\`\`\`

# Garden rollup
\`\`\`json
${rollupJson}
\`\`\``;
}

// ─── Response parsing ───────────────────────────────────────────────────────

export interface AnalysisParseResult {
  analyses: AIAnalysis[];
  errors: Array<{ raw: string; error: string }>;
}

// Strip a leading ```json fence and grab the outermost [...] array, so a reply
// wrapped in prose or fences still parses. Mirrors the worker's stripJsonFences,
// but targets an array rather than a single object.
function extractJsonArray(text: string): string | null {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  const first = t.indexOf("[");
  const last = t.lastIndexOf("]");
  if (first < 0 || last <= first) return null;
  return t.slice(first, last + 1);
}

function coerceVerdict(v: unknown): AIVerdict | null {
  if (typeof v !== "string") return null;
  const u = v.trim().toUpperCase();
  return u === "GOOD" || u === "BAD" || u === "MIXED" ? u : null;
}

function stripInlineCitations(text: string): string {
  return text.replace(/\s*\[\d+(?:[.,]\s*\d+)*\]/g, "").replace(/[ \t]{2,}/g, " ");
}

function extractLeadingVerdict(text: string): { verdict: AIVerdict | null; rest: string } {
  const m = text.match(/^\s*(GOOD|BAD|MIXED)\b[.:\s-]+/i);
  if (!m) return { verdict: null, rest: text };
  return { verdict: m[1].toUpperCase() as AIVerdict, rest: text.slice(m[0].length) };
}

/**
 * Parse a model reply into `AIAnalysis` records. Tolerates code fences and
 * surrounding prose. Each element is validated: verdict coerced, analysis
 * required, inline citations + a leading verdict word stripped, references kept
 * only when they're real http(s) strings. When `allowedPairs` is supplied, an
 * element whose `shortCode|zoneCode` isn't in it is flagged (guards against a
 * model hallucinating a code or analyzing a pair we didn't ask for). `created`
 * is stamped later, at apply time.
 */
export function parseAnalysisResponse(
  text: string,
  allowedPairs?: Set<string>,
): AnalysisParseResult {
  const analyses: AIAnalysis[] = [];
  const errors: Array<{ raw: string; error: string }> = [];

  if (!text.trim()) return { analyses, errors };

  const arrayText = extractJsonArray(text);
  if (!arrayText) {
    return { analyses, errors: [{ raw: text.trim().slice(0, 120), error: "No JSON array found" }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch (err) {
    return {
      analyses,
      errors: [{ raw: arrayText.slice(0, 120), error: `JSON parse failed: ${(err as Error).message}` }],
    };
  }
  if (!Array.isArray(parsed)) {
    return { analyses, errors: [{ raw: arrayText.slice(0, 120), error: "Expected a JSON array" }] };
  }

  const seen = new Set<string>();
  for (const item of parsed) {
    const raw = typeof item === "object" && item ? JSON.stringify(item).slice(0, 120) : String(item);
    if (typeof item !== "object" || !item) {
      errors.push({ raw, error: "Not an object" });
      continue;
    }
    const obj = item as Record<string, unknown>;
    const shortCode = typeof obj.shortCode === "string" ? obj.shortCode.trim() : "";
    const zoneCode = typeof obj.zoneCode === "string" ? obj.zoneCode.trim() : "";
    if (!shortCode || !zoneCode) {
      errors.push({ raw, error: "Missing shortCode or zoneCode" });
      continue;
    }
    const key = pairKey(shortCode, zoneCode);
    if (allowedPairs && !allowedPairs.has(key)) {
      errors.push({ raw, error: `Unrequested pair ${shortCode} @ ${zoneCode}` });
      continue;
    }
    if (seen.has(key)) {
      errors.push({ raw, error: `Duplicate pair ${shortCode} @ ${zoneCode}` });
      continue;
    }

    const rawAnalysis = typeof obj.analysis === "string" ? obj.analysis.trim() : "";
    if (!rawAnalysis) {
      errors.push({ raw, error: "Missing analysis text" });
      continue;
    }
    const stripped = extractLeadingVerdict(rawAnalysis);
    const verdict = coerceVerdict(obj.verdict) ?? stripped.verdict;
    if (!verdict) {
      errors.push({ raw, error: "No valid verdict (GOOD/BAD/MIXED)" });
      continue;
    }
    const analysis = stripInlineCitations(stripped.rest).trim();
    if (!analysis) {
      errors.push({ raw, error: "Analysis empty after cleanup" });
      continue;
    }
    const references = Array.isArray(obj.references)
      ? obj.references.filter((r): r is string => typeof r === "string" && /^https?:\/\//.test(r))
      : [];

    seen.add(key);
    analyses.push({ shortCode, zoneCode, verdict, analysis, references, created: "" });
  }

  return { analyses, errors };
}
