import { GoogleGenAI, Type } from "@google/genai";
import type { Content, Part } from "@google/genai";
import type { Env } from "./types";
import { HELP_HEADER } from "./help";
import { recordCost } from "./cost";

const MAX_TOOL_ITERATIONS = 3;
const TELEGRAM_MAX_LEN = 4096;
// /ask1 = flash-lite (cheap), /ask2 = flash (balanced), /ask3 = argon (best).
export const MODEL_ALIASES: Record<string, string> = {
  "1": "gemini-3.5-flash-lite",
  "2": "gemini-3.8-flash",
  "3": "gemini-4-argon",
};
// Bare /ask and /resp, and threads whose model has since been retired.
export const DEFAULT_MODEL_ALIAS = "3";
export const DEFAULT_MODEL = MODEL_ALIASES[DEFAULT_MODEL_ALIAS];

// Standard paid-tier USD per 1M tokens (verify at ai.google.dev/pricing).
//   i = uncached input, c = implicit-cache read, o = output (incl. thinking)
// None of these models has a >200k-prompt tier. Each model lists its price
// periods oldest-first; `from` is the UTC date a period takes effect, so
// announced price changes apply on schedule without a redeploy.
interface PricePeriod {
  from?: string;
  i: number;
  c: number;
  o: number;
}
const MODEL_PRICING: Record<string, PricePeriod[]> = {
  "gemini-4-argon": [
    { i: 2.0, c: 0.1, o: 10.0 },
    { from: "2026-12-01", i: 4.0, c: 0.2, o: 20.0 },
  ],
  "gemini-3.8-flash": [
    { i: 0.75, c: 0.075, o: 3.75 },
    { from: "2027-01-01", i: 1.5, c: 0.15, o: 7.5 },
  ],
  "gemini-3.5-flash-lite": [{ i: 0.3, c: 0.03, o: 2.5 }],
};

export interface Thread {
  model: string;
  history: Content[];
}

export interface ProposedCommand {
  command: string;
  rationale: string;
}

export interface AnswerResult {
  reply: string;
  thread: Thread;
  proposals: ProposedCommand[];
}

const ALLOWED_VERBS = [
  "/addtag",
  "/removetag",
  "/update",
  "/merge",
  "/accept",
  "/annotate",
  "/addzone",
  "/renamezone",
  "/deletezonepic",
  "/delete",
  "/deleteannotation",
  "/remove",
  "/restore",
  "/relate",
  "/unrelate",
  "/reltype",
] as const;

export interface Usage {
  prompt: number;
  /** Prompt tokens Gemini served from its implicit cache (a subset of prompt). */
  cached: number;
  output: number;
}

// Estimated USD cost for a usage breakdown at the rates in effect on `at`, or
// null if the model is unpriced.
export function estimateCost(model: string, usage: Usage, at: Date = new Date()): number | null {
  const periods = MODEL_PRICING[model];
  if (!periods) return null;
  const day = at.toISOString().slice(0, 10);
  let p = periods[0];
  for (const period of periods) if (!period.from || period.from <= day) p = period;
  const uncached = usage.prompt - usage.cached;
  return (uncached * p.i + usage.cached * p.c + usage.output * p.o) / 1_000_000;
}

export function formatUsd(cost: number): string {
  return cost < 0.0001 ? "<$0.0001" : `$${cost.toFixed(4)}`;
}

async function loadRollup(env: Env): Promise<string> {
  const base = env.DATA_BASE_URL ?? "https://plantyj.com/data";
  const res = await fetch(`${base}/rollup.min.json`, {
    cf: { cacheTtl: 60, cacheEverything: true } as RequestInitCfProperties,
  });
  if (!res.ok) throw new Error(`Failed to fetch rollup: ${res.status}`);
  return res.text();
}

async function getSpecies(fullName: string, env: Env): Promise<string> {
  const base = env.DATA_BASE_URL ?? "https://plantyj.com/data";
  const slug = fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const res = await fetch(`${base}/species.json`, {
    cf: { cacheTtl: 60, cacheEverything: true } as RequestInitCfProperties,
  });
  if (!res.ok) throw new Error(`Failed to fetch species bundle: ${res.status}`);
  const bundle = (await res.json()) as { species?: Record<string, unknown> };
  const entry = bundle.species?.[slug];
  if (!entry) return `No species record found for "${fullName}".`;
  return JSON.stringify(entry);
}

function buildSystemPrompt(rollupJson: string): string {
  const verbList = ALLOWED_VERBS.join(", ");
  return `You are the PlantyJ garden-journal assistant. The user keeps a private photo journal of plants, animals, and zones at their home in Minneapolis, MN (USDA hardiness zone 4b/5a). The property sits on the northwest corner of a city block with clay/loam soil. The gardeners prioritize native plants, edibles, medicinals, and supporting local ecology. Answer their questions factually from the data below. When they want to add or change data — or your answer naturally suggests changes worth making — call propose_commands with the list, so the user can run /confirm to execute them.

# Bot command reference
${HELP_HEADER}

# Garden rollup (precomputed, plant-centric)
# Schema:
#   zones[]:  { code, name?, hasZonePic?, description? }
#   plants[]: { shortCode, fullName?, commonName?, variety?, kind?,
#               tags?, description?,
#               byZone?: { <zoneCode>: { tags?, description?, removed? } },
#               pics[]: { seq, zone?, tags?, description?, at? },
#               picCount, zonesSeen[], lastSeenAt?, firstSeenAt? }
#   orphanPics[]: pics whose shortCode no longer maps to a plant
#   relationships:
#     types[]: { id, name, description, directional }
#     edges[]: [id, typeId, fromCode, toCode, direction] where direction is
#       "f" (forward), "b" (backward), "u" (undirected), or null = type default.
# pics[] is newest-first. Fields marked "?" are omitted when null/empty.
# All dates are day-precision (YYYY-MM-DD). "kind" is omitted when "plant".
${rollupJson}

# Calling get_species
# To answer questions about taxonomy, native range, or anything from Wikipedia, call get_species with a plant's fullName. Returns nativeRange (often null), description, taxonomy, vernacularNames.

# Calling propose_commands
# Whenever your answer involves adding or changing data, call propose_commands ONCE with the full list of commands. Each proposal is { command, rationale }.
# - command: the literal slash command, exactly as the user would type it (no leading whitespace, no trailing newline)
# - rationale: a short (one-line) explanation grounded in the rollup data
# After calling propose_commands, your text reply should be a brief summary describing what you're proposing and any caveats — the user will see a numbered list of commands and reply /confirm (all) or /confirm 1 3 (subset) or /cancel. Do NOT also embed the commands inline in your text reply; the numbered list is appended automatically.
# For pure read-only questions (no changes implied), do not call propose_commands.

# Allowed verbs for propose_commands (anything else is rejected)
${verbList}
# /deletezone is intentionally excluded — recommend it in prose if needed and the user will run it manually.

# Behavior rules
- When asked about coverage gaps (untagged, missing zone pic, etc.), propose one command per plant via propose_commands.
- When suggesting a photo caption, use the canonical format:
    shortCode // fullName // commonName // Zone (code) // tags // description
- For native-range questions, prefer get_species() over guessing. If nativeRange is null, fall back to the species description text.
- Never invent seq numbers, shortCodes, or zoneCodes — they must come from the rollup.
- For /update, the field must be one of: shortCode, fullName, commonName, zoneCode, tags, description.
- Do not propose duplicates or no-ops (e.g. adding a tag that's already present).
- To mark a plant+zone combo as removed from the garden (it died, was pulled, etc.), propose /remove {shortCode} // {zoneCode}; to undo, /restore {shortCode} // {zoneCode}. zoneCode is required — removal is always per plant+zone. A removed combo still shows in the gallery (flagged) but drops out of the food web, tree, and zone/plant views. Use byZone[zoneCode].removed in the rollup to see current state; don't propose a /remove for a combo already removed, or a /restore for one that isn't.
- For /relate, the format is: /relate <typeId> // <fromCode> // <toCode> [// f|b|u]. Use // as the field separator — shortCodes may contain spaces (e.g. "V virg", "I uni alb") so space-splitting is ambiguous. typeId must be an exact id from relationships.types[]. fromCode and toCode must be exact values from plants[].shortCode — copy them verbatim, no abbreviation. Direction is optional (f=forward, b=backward, u=undirected). If the user asks for a relationship that doesn't fit an existing type, propose a /reltype to create the type FIRST in the same batch, then /relate using that new id.
- Never claim to have executed a command. The user runs /confirm to apply proposals.
- Reply in plain text, no Markdown. Telegram replies are 4096 chars max — keep it tight.`;
}

function truncateForTelegram(text: string): string {
  if (text.length <= TELEGRAM_MAX_LEN) return text;
  const cutoff = text.lastIndexOf("\n", TELEGRAM_MAX_LEN - 30);
  const pos = cutoff > TELEGRAM_MAX_LEN / 2 ? cutoff : TELEGRAM_MAX_LEN - 30;
  return text.slice(0, pos) + "\n[...truncated]";
}

function formatCost(model: string, usage: Usage): string {
  const cost = estimateCost(model, usage);
  if (cost === null) return "";
  const costStr = formatUsd(cost);
  const cacheNote = usage.cached > 0 ? ` ${usage.cached.toLocaleString()} cached,` : "";
  return `[${costStr} |${cacheNote} ${usage.prompt.toLocaleString()} in / ${usage.output.toLocaleString()} out]`;
}

const GET_SPECIES_DECLARATION = {
  name: "get_species",
  description: "Fetch the enriched species record for a plant by its fullName.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      fullName: {
        type: Type.STRING,
        description: "The plant's full scientific name, e.g. 'Allium tricoccum'",
      },
    },
    required: ["fullName"],
  },
};

const PROPOSE_COMMANDS_DECLARATION = {
  name: "propose_commands",
  description:
    "Submit a list of bot commands for the user to confirm. Call this whenever your answer involves changes to data. Call exactly once per turn; the user will see a numbered list and run /confirm.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      commands: {
        type: Type.ARRAY,
        description: "Ordered list of proposals. Empty array means no actions.",
        items: {
          type: Type.OBJECT,
          properties: {
            command: {
              type: Type.STRING,
              description: "The literal slash command, e.g. '/addtag 42 native'",
            },
            rationale: {
              type: Type.STRING,
              description: "One-line reason grounded in the rollup data.",
            },
          },
          required: ["command", "rationale"],
        },
      },
    },
    required: ["commands"],
  },
};

const TOOL_DECLARATIONS = [GET_SPECIES_DECLARATION, PROPOSE_COMMANDS_DECLARATION];

function isAllowedVerb(command: string): boolean {
  const verb = command.trim().split(/\s+/)[0];
  return (ALLOWED_VERBS as readonly string[]).includes(verb);
}

function sanitizeProposals(raw: unknown): ProposedCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposedCommand[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { command?: unknown; rationale?: unknown };
    const command = typeof r.command === "string" ? r.command.trim() : "";
    const rationale = typeof r.rationale === "string" ? r.rationale.trim() : "";
    if (!command || !command.startsWith("/")) continue;
    if (!isAllowedVerb(command)) continue;
    if (seen.has(command)) continue;
    seen.add(command);
    out.push({ command, rationale: rationale || "(no rationale)" });
  }
  return out;
}

export async function answerQuestion(
  question: string,
  env: Env,
  modelOverride?: string,
  priorHistory?: Content[],
  style?: string,
): Promise<AnswerResult> {
  const rollupJson = await loadRollup(env);
  const model = modelOverride ?? DEFAULT_MODEL;
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  // No explicit context cache: the rollup-heavy system prompt is a stable
  // prefix, so Gemini's implicit caching discounts repeat calls automatically
  // (reported as cachedContentTokenCount) with no storage fee.
  const config = {
    systemInstruction: buildSystemPrompt(rollupJson),
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
  };

  // Style is injected per-turn so the system prompt stays a cacheable prefix.
  const questionText = style ? `[Respond in this style: ${style}]\n\n${question}` : question;
  const contents: Content[] = [
    ...(priorHistory ?? []),
    { role: "user", parts: [{ text: questionText }] },
  ];

  const totalUsage: Usage = { prompt: 0, cached: 0, output: 0 };
  let proposals: ProposedCommand[] = [];

  for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
    const response = await client.models.generateContent({ model, contents, config });

    const meta = response.usageMetadata;
    if (meta) {
      totalUsage.prompt += meta.promptTokenCount ?? 0;
      totalUsage.cached += meta.cachedContentTokenCount ?? 0;
      totalUsage.output += (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
    }

    const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);

    // Capture proposals from this turn (last call wins if the model misbehaves
    // and emits more than one).
    for (const c of calls) {
      if (c.functionCall?.name === "propose_commands") {
        const args = (c.functionCall.args ?? {}) as { commands?: unknown };
        proposals = sanitizeProposals(args.commands);
      }
    }

    if (calls.length === 0 || i === MAX_TOOL_ITERATIONS) {
      contents.push({ role: "model", parts });
      const text = parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("\n")
        .trim();
      const costLine = formatCost(model, totalUsage);
      await recordCost(env, model, totalUsage).catch((err) =>
        console.log(`[ask] recordCost failed: ${(err as Error).message}`),
      );
      const body = truncateForTelegram(text || "No response.");
      const reply = costLine ? `${body}\n${costLine}` : body;
      return { reply, thread: { model, history: contents }, proposals };
    }

    contents.push({ role: "model", parts });

    // Answer each tool call. propose_commands is acknowledged so the model can
    // follow up with its summary text; get_species fetches the data.
    const results: Part[] = await Promise.all(
      calls.map(async (p) => {
        const name = p.functionCall?.name ?? "";
        const args = p.functionCall?.args ?? {};
        let result: string;
        if (name === "get_species") {
          result = await getSpecies(args.fullName as string, env);
        } else if (name === "propose_commands") {
          const count = sanitizeProposals((args as { commands?: unknown }).commands).length;
          result = `Recorded ${count} proposal(s). Reply with a short plain-text summary for the user (no further tool calls).`;
        } else {
          result = `Unknown tool: ${name}`;
        }
        return { functionResponse: { name, response: { result } } };
      }),
    );

    contents.push({ role: "user", parts: results });
  }

  return {
    reply: "Could not generate a response.",
    thread: { model, history: contents },
    proposals,
  };
}
