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
  /** History of user prompts in this identify session (initial /identify hint
   *  first, then each /resp follow-up). Used to give the model context on a
   *  refine turn. */
  userPrompts: string[];
}

export interface IdentifyResult {
  /** Full Telegram message body (overview + numbered list + instructions). */
  body: string;
  candidates: IdentifyCandidate[];
}

export interface IdentifyPriorContext {
  candidates: IdentifyCandidate[];
  prompts: string[];
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
          tags: {
            type: Type.STRING,
            description:
              "Optional comma-separated tags to attach to this photo. Use bare tags for pic-level (edible, fruiting), +tag for plant+zone-level (+native), or ++tag for plant-level (++medicinal). '' if no tags.",
          },
          description: {
            type: Type.STRING,
            description:
              "Optional short free-text description to attach to this photo (e.g. 'first ripe fruit'). '' if none.",
          },
        },
        required: ["commonName", "scientificName", "zoneCode", "confidence", "notes"],
      },
    },
    message: {
      type: Type.STRING,
      description:
        "Optional overview. On a refine turn this is where you answer the user's question or explain what changed.",
    },
  },
  required: ["candidates"],
};

function formatPriorCandidate(c: IdentifyCandidate, i: number): string {
  return `${i + 1}. ${c.label}\n     ${c.notes}\n     caption: ${c.caption}`;
}

function buildPrompt(
  rollup: Rollup,
  userPrompt: string | null,
  prior: IdentifyPriorContext | null,
): string {
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

  const intro = prior
    ? `You are the PlantyJ garden-journal identification assistant. You previously identified the organism in the attached photo and the user has sent a follow-up. The same photo is attached again.`
    : `You are the PlantyJ garden-journal identification assistant. Identify the organism in the attached photo.`;

  const context = `Context: a private garden journal for a property in Minneapolis, MN (USDA hardiness zone 4b/5a), NW corner of a city block, clay/loam soil. The gardeners prioritize native plants, edibles, and medicinals. Today is ${today} — use Minneapolis seasonality to inform plausibility (what is in leaf/flower/fruit now etc).`;

  let priorBlock = "";
  if (prior) {
    const earlierPrompts = prior.prompts
      .map((p, i) => `  ${i === 0 ? "initial /identify" : `/resp #${i}`}: ${p || "(no text)"}`)
      .join("\n");
    const priorList =
      prior.candidates.length > 0
        ? prior.candidates.map(formatPriorCandidate).join("\n")
        : "  (none — you previously couldn't identify it)";
    priorBlock = `\n# Prior turns in this identify session\n${earlierPrompts}\n\n# Candidates you previously offered\n${priorList}\n`;
  }

  const userBlock = userPrompt
    ? prior
      ? `The user's latest follow-up: "${userPrompt}"`
      : `The user says: "${userPrompt}"\nTreat this as a strong hint about what they think it is, what to focus on, and possibly which zone it is in.`
    : prior
      ? `The user sent /resp with no extra text — treat this as a request to take another look from scratch.`
      : `The user gave no extra description — identify from the image alone.`;

  const refineTaskRules = prior
    ? `
# Task (refine turn)
The user is iterating on the prior identification. Use the photo + the prior candidates + their follow-up to do whichever of these fit:
- ANSWER A QUESTION: if the follow-up is a question about a candidate (e.g. "is this edible?", "what's its native range?"), put your answer in "message" and return the prior candidates UNCHANGED in the same order (copy them verbatim into the response so /pick keeps working).
- ADD TAGS / DESCRIPTION: if the user asks for tags or a description to be attached, return the same candidates but populate the "tags" and/or "description" fields. Tags: bare for pic-level, "+" for plant+zone-level, "++" for plant-level.
- CHANGE ZONE: if the user names a different zone, update zoneCode on the relevant candidates.
- SWAP OR ADD A SPECIES: if the user suggests or asks about a different ID, replace or add candidates accordingly (still 1–${MAX_CANDIDATES} total, most→least likely). Use "message" briefly to note what changed and why.
- "message" is plain text shown to the user above the new candidate list. Keep it concise (1–3 short lines).`
    : `
# Task
Return 1–${MAX_CANDIDATES} candidate identifications, ordered most→least likely.`;

  return `${intro}

${context}

${userBlock}
${priorBlock}
# Known zones (use an exact code for zoneCode)
${zoneList}

# Existing plants (set matchedShortCode to one of these ONLY if the photo is clearly that same plant; copy the shortCode verbatim, spaces included)
${plantList}
${refineTaskRules}

# Candidate fields
- commonName + scientificName (binomial only; put any cultivar in "variety").
- If it is clearly an already-registered plant above, set matchedShortCode to its exact shortCode (then a NEW plant record won't be created). Otherwise leave matchedShortCode "".
- zoneCode: if the user named a zone/location, map it to the closest code above. Otherwise pick the single most plausible existing zone and say so in "notes". Always provide a zoneCode from the list.
- confidence: high / medium / low.
- notes: one short line — what visual features drove the call, how to confirm, and flag any guess (especially a guessed zone).
- tags: optional comma-separated tags. Only fill if the user asked for tags or they are obviously appropriate (e.g. visible fruit → "fruiting"). Bare = pic-level, "+x" = plant+zone-level, "++x" = plant-level.
- description: optional short free-text note for the photo. Only fill if useful.

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
  tags?: unknown;
  description?: unknown;
}

function buildCaption(c: RawCandidate, knownShortCodes: Set<string>): string | null {
  const sci = typeof c.scientificName === "string" ? sanitizeLine(c.scientificName) : "";
  const common = typeof c.commonName === "string" ? sanitizeLine(c.commonName) : "";
  const variety = typeof c.variety === "string" ? sanitizeLine(c.variety) : "";
  const zone = typeof c.zoneCode === "string" ? sanitizeLine(c.zoneCode) : "";
  const matched =
    typeof c.matchedShortCode === "string" ? sanitizeLine(c.matchedShortCode) : "";
  const tags = typeof c.tags === "string" ? sanitizeLine(c.tags) : "";
  const description = typeof c.description === "string" ? sanitizeLine(c.description) : "";

  if (!zone) return null; // a caption with no zone can't be ingested

  // Drop trailing empty fields so we don't emit dangling " // " segments when
  // tags and description are both blank.
  const trim = (parts: string[]): string => {
    let end = parts.length;
    while (end > 0 && parts[end - 1] === "") end--;
    return parts.slice(0, end).join(" // ");
  };

  // Existing plant: attach the photo to it (fullName/commonName inherit).
  if (matched && knownShortCodes.has(matched)) {
    return trim([matched, "", "", zone, tags, description]);
  }
  // New plant: blank shortCode → auto-generated from the species name.
  if (!sci) return null;
  const name = variety ? `${sci} '${variety}'` : sci;
  return trim(["", name, common, zone, tags, description]);
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
  prior: IdentifyPriorContext | null = null,
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
          { text: buildPrompt(rollup, userPrompt, prior) },
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
  // Refine answers can legitimately span 2–3 short lines; preserve newlines
  // here while still stripping leading/trailing whitespace and CRs.
  const overview =
    typeof parsed.message === "string" ? parsed.message.replace(/\r/g, "").trim() : "";
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
    const nextSteps = prior
      ? `Reply /resp {hint} to try again with more context, or /cancel to drop the session.`
      : `Try /identify again with a clearer photo or a hint (e.g. "/identify likely a sedge in fb1"), or post it normally as unidentified: id // {zoneCode} [// note]`;
    const body = `${why}\n\n${nextSteps}` + (costLine ? `\n${costLine}` : "");
    return { body, candidates: [] };
  }

  const lines: string[] = [];
  if (overview) lines.push(overview, "");
  lines.push(prior ? "Updated identification options:" : "Identification options:", "");
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
    `Reply /pick N to save the photo with that identification (committed like a normal upload), /resp {follow-up} to refine further (add tags, suggest another species, ask a question), or /cancel to discard.`,
  );
  if (costLine) lines.push("", costLine);

  return { body: lines.join("\n"), candidates };
}
