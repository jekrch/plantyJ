import { GoogleGenAI, Type } from "@google/genai";
import type { Env } from "./types";
import { estimateCost, formatUsd, type Usage } from "./ask";

// Vision identification runs on the cron path (like /ask and /analyze) so the
// Gemini call never blocks the Telegram webhook. Pro has the strongest vision.
const IDENTIFY_MODEL = "gemini-3.1-pro-preview";
const MAX_CANDIDATES = 3;

export const PENDING_IDENTIFY_KEY = (userId: number) => `pending:identify:${userId}`;
export const PENDING_IDENTIFY_TTL = 3600; // 1h, same as /ask pending proposals

export interface IdentifyCandidate {
  /** Human-readable one-liner shown in the numbered list. */
  label: string;
  /** Canonical photo caption, ready to ingest exactly like a normal upload. */
  caption: string;
  confidence: string;
  notes: string;
}

export interface PendingIdentify {
  createdAt: string;
  fileId: string;
  width?: number;
  height?: number;
  postedBy: string;
  candidates: IdentifyCandidate[];
}

export interface IdentifyResult {
  /** Full Telegram message body (overview + numbered list + instructions). */
  body: string;
  candidates: IdentifyCandidate[];
}

interface RollupZone {
  code: string;
  name?: string;
}
interface RollupPlant {
  shortCode: string;
  fullName?: string;
  commonName?: string;
}
interface Rollup {
  zones: RollupZone[];
  plants: RollupPlant[];
}

async function loadRollup(env: Env): Promise<Rollup> {
  const base = env.DATA_BASE_URL ?? "https://plantyj.com/data";
  const res = await fetch(`${base}/rollup.min.json`, {
    cf: { cacheTtl: 60, cacheEverything: true } as RequestInitCfProperties,
  });
  if (!res.ok) throw new Error(`rollup fetch failed: ${res.status}`);
  return (await res.json()) as Rollup;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    candidates: {
      type: Type.ARRAY,
      description: "1–3 identifications, most likely first. Empty if not identifiable.",
      items: {
        type: Type.OBJECT,
        properties: {
          commonName: { type: Type.STRING, description: "Common name, '' if unknown." },
          scientificName: {
            type: Type.STRING,
            description: "Binomial 'Genus species' (no variety here).",
          },
          variety: { type: Type.STRING, description: "Cultivar/variety, '' if none." },
          matchedShortCode: {
            type: Type.STRING,
            description:
              "Exact shortCode of an existing plant this clearly is, copied verbatim from the provided list. '' if it is a new plant.",
          },
          zoneCode: {
            type: Type.STRING,
            description: "Exact zone code from the provided list this photo belongs to.",
          },
          confidence: { type: Type.STRING, description: "high | medium | low" },
          notes: {
            type: Type.STRING,
            description:
              "One short line: distinguishing features seen, how to confirm, any assumptions (e.g. guessed zone).",
          },
        },
        required: ["commonName", "scientificName", "zoneCode", "confidence", "notes"],
      },
    },
    message: {
      type: Type.STRING,
      description: "Optional one-line overview (e.g. why uncertain, or if no zone could be picked).",
    },
  },
  required: ["candidates"],
};

function buildPrompt(rollup: Rollup, userPrompt: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  const zoneList =
    rollup.zones.length > 0
      ? rollup.zones.map((z) => `  ${z.code}${z.name ? ` — ${z.name}` : ""}`).join("\n")
      : "  (none defined yet)";
  const plantList =
    rollup.plants.length > 0
      ? rollup.plants
          .map(
            (p) =>
              `  ${p.shortCode} | ${p.commonName ?? "?"}${p.fullName ? ` | ${p.fullName}` : ""}`,
          )
          .join("\n")
      : "  (none registered yet)";

  return `You are the PlantyJ garden-journal identification assistant. Identify the organism in the attached photo.

Context: a private garden journal for a property in Minneapolis, MN (USDA hardiness zone 4b/5a), NW corner of a city block, clay/loam soil. The gardeners prioritize native plants, edibles, and medicinals. Today is ${today} — use Minneapolis seasonality to inform plausibility (what is in leaf/flower/fruit now etc).

${userPrompt ? `The user says: "${userPrompt}"\nTreat this as a strong hint about what they think it is, what to focus on, and possibly which zone it is in.` : "The user gave no extra description — identify from the image alone."}

# Known zones (use an exact code for zoneCode)
${zoneList}

# Existing plants (set matchedShortCode to one of these ONLY if the photo is clearly that same plant; copy the shortCode verbatim, spaces included)
${plantList}

# Task
Return 1–${MAX_CANDIDATES} candidate identifications, ordered most→least likely. For each:
- commonName + scientificName (binomial only; put any cultivar in "variety").
- If it is clearly an already-registered plant above, set matchedShortCode to its exact shortCode (then a NEW plant record won't be created). Otherwise leave matchedShortCode "".
- zoneCode: if the user named a zone/location, map it to the closest code above. Otherwise pick the single most plausible existing zone and say so in "notes". Always provide a zoneCode from the list.
- confidence: high / medium / low.
- notes: one short line — what visual features drove the call, how to confirm, and flag any guess (especially a guessed zone).
If you genuinely cannot identify it, return an empty candidates array and explain briefly in "message".`;
}

function sanitizeLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

interface RawCandidate {
  commonName?: unknown;
  scientificName?: unknown;
  variety?: unknown;
  matchedShortCode?: unknown;
  zoneCode?: unknown;
  confidence?: unknown;
  notes?: unknown;
}

function buildCaption(c: RawCandidate, knownShortCodes: Set<string>): string | null {
  const sci = typeof c.scientificName === "string" ? sanitizeLine(c.scientificName) : "";
  const common = typeof c.commonName === "string" ? sanitizeLine(c.commonName) : "";
  const variety = typeof c.variety === "string" ? sanitizeLine(c.variety) : "";
  const zone = typeof c.zoneCode === "string" ? sanitizeLine(c.zoneCode) : "";
  const matched =
    typeof c.matchedShortCode === "string" ? sanitizeLine(c.matchedShortCode) : "";

  if (!zone) return null; // a caption with no zone can't be ingested

  // Existing plant: attach the photo to it (fullName/commonName inherit).
  if (matched && knownShortCodes.has(matched)) {
    return `${matched} // // // ${zone}`;
  }
  // New plant: blank shortCode → auto-generated from the species name.
  if (!sci) return null;
  const name = variety ? `${sci} '${variety}'` : sci;
  return `// ${name} // ${common} // ${zone}`;
}

/**
 * Send the photo to Gemini and turn its answer into ready-to-ingest caption
 * candidates. Caller persists the candidates + fileId so /pick can commit the
 * chosen one exactly like a normal photo upload.
 */
export async function identifyPhoto(
  env: Env,
  imageBase64: string,
  userPrompt: string | null,
): Promise<IdentifyResult> {
  const rollup = await loadRollup(env);
  const knownShortCodes = new Set(rollup.plants.map((p) => p.shortCode));
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const response = await client.models.generateContent({
    model: IDENTIFY_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: buildPrompt(rollup, userPrompt) },
          { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        ],
      },
    ],
    config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  });

  const meta = response.usageMetadata;
  const usage: Usage = {
    prompt: meta?.promptTokenCount ?? 0,
    cached: 0,
    output: meta?.candidatesTokenCount ?? 0,
    cacheCreation: 0,
  };
  const cost = estimateCost(IDENTIFY_MODEL, usage);
  const costLine =
    cost === null
      ? ""
      : `[${formatUsd(cost)} | ${usage.prompt.toLocaleString()} in / ${usage.output.toLocaleString()} out]`;

  let parsed: { candidates?: unknown; message?: unknown };
  try {
    parsed = JSON.parse(response.text ?? "{}");
  } catch {
    parsed = {};
  }
  const overview = typeof parsed.message === "string" ? sanitizeLine(parsed.message) : "";
  const rawList = Array.isArray(parsed.candidates) ? parsed.candidates : [];

  const candidates: IdentifyCandidate[] = [];
  for (const raw of rawList.slice(0, MAX_CANDIDATES)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as RawCandidate;
    const caption = buildCaption(c, knownShortCodes);
    if (!caption) continue;
    const common = typeof c.commonName === "string" ? sanitizeLine(c.commonName) : "";
    const sci = typeof c.scientificName === "string" ? sanitizeLine(c.scientificName) : "";
    const variety = typeof c.variety === "string" ? sanitizeLine(c.variety) : "";
    const matched =
      typeof c.matchedShortCode === "string" ? sanitizeLine(c.matchedShortCode) : "";
    const confidence =
      typeof c.confidence === "string" ? sanitizeLine(c.confidence) : "unknown";
    const notes = typeof c.notes === "string" ? sanitizeLine(c.notes) : "";
    const isExisting = !!matched && knownShortCodes.has(matched);
    const label =
      `${common || sci || "Unknown"}${sci && common ? ` (${sci}${variety ? ` '${variety}'` : ""})` : ""}` +
      ` — ${confidence} confidence`;
    candidates.push({
      label,
      caption,
      confidence,
      notes:
        (isExisting ? `existing plant "${matched}". ` : "new plant. ") +
        (notes || "(no notes)"),
    });
  }

  if (candidates.length === 0) {
    const why = overview || "Could not identify the organism in this photo.";
    const body =
      `${why}\n\n` +
      `Try /identify again with a clearer photo or a hint (e.g. "/identify likely a sedge in fb1"), ` +
      `or post it normally as unidentified: id // {zoneCode} [// note]` +
      (costLine ? `\n${costLine}` : "");
    return { body, candidates: [] };
  }

  const lines: string[] = [];
  if (overview) lines.push(overview, "");
  lines.push("Identification options:", "");
  candidates.forEach((c, i) => {
    lines.push(
      `${i + 1}. ${c.label}`,
      `   ${c.notes}`,
      `   caption: ${c.caption}`,
      `   → /pick ${i + 1}`,
      "",
    );
  });
  lines.push(
    `Reply /pick N to save the photo with that identification (committed like a normal upload), or /cancel to discard.`,
  );
  if (costLine) lines.push("", costLine);

  return { body: lines.join("\n"), candidates };
}
