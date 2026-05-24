import { GoogleGenAI, Type } from "@google/genai";
import type { Content, Part } from "@google/genai";
import type { Env } from "./types";
import { HELP_HEADER } from "./help";
import { recordCost } from "./cost";

const MAX_TOOL_ITERATIONS = 3;
const TELEGRAM_MAX_LEN = 4096;
const CACHE_TTL_SECONDS = 3600; // 1 hour; recreated only when rollup checksum changes
// Bare /ask  = /ask2 (flash, default), /ask1 = lite (cheap),
// /ask2 = flash 3.5 (balanced), /ask3 = pro preview (best).
export const MODEL_ALIASES: Record<string, string> = {
  "1": "gemini-3.1-flash-lite-preview",
  "2": "gemini-3.5-flash",
  "3": "gemini-3.1-pro-preview",
};

// Per-1M-token rates (verify at ai.google.dev/pricing).
// Tiers are [≤200k prompt tokens, >200k prompt tokens]; flat-rate models
// repeat the same value in both slots.
//   i = uncached input, c = cached input read, o = output (incl. thinking),
//   s = cache storage per hour (single rate, not tier-split)
interface Pricing {
  i: [number, number];
  c: [number, number];
  o: [number, number];
  s: number;
}
const MODEL_PRICING: Record<string, Pricing> = {
  // Confirmed against the user's pricing table (Gemini 3 Pro Preview).
  "gemini-3.1-pro-preview": { i: [2.0, 4.0], c: [0.2, 0.4], o: [12.0, 18.0], s: 4.5 },
  // Gemini 2.5 Pro public rates — same two-tier structure.
  "gemini-2.5-pro": { i: [1.25, 2.5], c: [0.31, 0.625], o: [10.0, 15.0], s: 4.5 },
  // Flash-lite is flat-rate across prompt size (approximate — verify).
  "gemini-3.1-flash-lite-preview": { i: [0.1, 0.1], c: [0.025, 0.025], o: [0.4, 0.4], s: 1.0 },
  // Gemini 3.5 Flash paid-tier rates (single tier; input $1.50/M, output $9/M,
  // cached read $0.15/M, storage $1/M-tok-hr). Verify the model string against
  // Google's docs before deploying — naming hasn't been confirmed publicly.
  "gemini-3.5-flash": { i: [1.5, 1.5], c: [0.15, 0.15], o: [9.0, 9.0], s: 1.0 },
};

const LARGE_PROMPT_TOKENS = 200_000;

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

interface CacheState {
  checksum: string;
  cacheName: string;
  expiresAt: number;
}

const ALLOWED_VERBS = [
  "/addtag",
  "/removetag",
  "/update",
  "/accept",
  "/annotate",
  "/addzone",
  "/renamezone",
  "/deletezonepic",
  "/delete",
  "/deleteannotation",
  "/relate",
  "/unrelate",
  "/reltype",
] as const;

export interface Usage {
  prompt: number;
  cached: number;
  output: number;
  cacheCreation: number;
  /** Token-hours the context cache is kept alive (cacheCreationTokens × TTL_hours).
   *  Priced separately from the per-call cache-creation input charge. */
  cacheStorageTokenHours: number;
}

// Estimated USD cost for a usage breakdown, or null if the model is unpriced.
// Tier is chosen by prompt size: prompts >200k tokens hit the higher rate for
// input, cached input, and output. Cache storage and cache creation are
// billed at the lower-tier input rate (cache creation is metered as input).
export function estimateCost(model: string, usage: Usage): number | null {
  const p = MODEL_PRICING[model];
  if (!p) return null;
  const tier = usage.prompt > LARGE_PROMPT_TOKENS ? 1 : 0;
  const uncached = usage.prompt - usage.cached;
  return (
    (uncached * p.i[tier] +
      usage.cached * p.c[tier] +
      usage.output * p.o[tier] +
      usage.cacheCreation * p.i[tier] +
      usage.cacheStorageTokenHours * p.s) /
    1_000_000
  );
}

export function formatUsd(cost: number): string {
  return cost < 0.0001 ? "<$0.0001" : `$${cost.toFixed(4)}`;
}

async function computeChecksum(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
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
#               byZone?: { <zoneCode>: { tags?, description? } },
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
  const createNote =
    usage.cacheCreation > 0 ? ` +${usage.cacheCreation.toLocaleString()} cache-create,` : "";
  return `[${costStr} |${createNote}${cacheNote} ${usage.prompt.toLocaleString()} in / ${usage.output.toLocaleString()} out]`;
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

// Returns a valid Gemini cache name from KV, or creates+stores a new one.
// Falls back to undefined on any error so callers can proceed without caching.
async function getOrCreateCache(
  client: GoogleGenAI,
  model: string,
  systemPrompt: string,
  rollupJson: string,
  env: Env,
): Promise<{
  cacheName: string | undefined;
  cacheCreationTokens: number;
  cacheStorageTokenHours: number;
}> {
  if (!env.ASK_CACHE)
    return { cacheName: undefined, cacheCreationTokens: 0, cacheStorageTokenHours: 0 };
  try {
    const checksum = await computeChecksum(rollupJson);
    // v2: cache contents include propose_commands tool — old v1 caches lack it.
    const kvKey = `cache:v2:${model}`;
    const raw = await env.ASK_CACHE.get(kvKey);

    let staleCacheName: string | undefined;
    if (raw) {
      const state: CacheState = JSON.parse(raw);
      if (state.checksum === checksum && state.expiresAt > Date.now()) {
        // Cache hit — no new tokens stored, so no storage charge for this call.
        return { cacheName: state.cacheName, cacheCreationTokens: 0, cacheStorageTokenHours: 0 };
      }
      staleCacheName = state.cacheName;
    }

    // Create a new Gemini context cache with the static parts of the prompt.
    // The model path must use the full resource name for the caching API.
    const cache = await client.caches.create({
      model: model.startsWith("models/") ? model : `models/${model}`,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        ttl: `${CACHE_TTL_SECONDS}s`,
      },
    });

    // Replacing an existing cache: explicitly delete the old one so it doesn't
    // sit unreferenced on Gemini's side until its TTL expires. Best-effort —
    // a 404 here just means Gemini already evicted it.
    if (staleCacheName) {
      await client.caches.delete({ name: staleCacheName }).catch(() => {});
    }

    const state: CacheState = {
      checksum,
      cacheName: cache.name!,
      expiresAt: Date.now() + (CACHE_TTL_SECONDS - 60) * 1000,
    };
    await env.ASK_CACHE.put(kvKey, JSON.stringify(state), {
      expirationTtl: CACHE_TTL_SECONDS,
    });

    const creationTokens =
      (cache.usageMetadata as { totalTokenCount?: number } | undefined)?.totalTokenCount ?? 0;
    // Charge full TTL up front. Early eviction (404 retry path) or replacement
    // before TTL would reduce this; accepting a slight over-estimate keeps the
    // ledger simple — no need to track per-cache lifetime.
    const cacheStorageTokenHours = creationTokens * (CACHE_TTL_SECONDS / 3600);
    return { cacheName: cache.name!, cacheCreationTokens: creationTokens, cacheStorageTokenHours };
  } catch {
    // Caching is best-effort; any failure falls back to uncached.
    return { cacheName: undefined, cacheCreationTokens: 0, cacheStorageTokenHours: 0 };
  }
}

export async function answerQuestion(
  question: string,
  env: Env,
  modelOverride?: string,
  priorHistory?: Content[],
  style?: string,
): Promise<AnswerResult> {
  const rollupJson = await loadRollup(env);
  const model = modelOverride ?? env.LLM_MODEL ?? MODEL_ALIASES["2"];
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const systemPrompt = buildSystemPrompt(rollupJson);

  const { cacheName, cacheCreationTokens, cacheStorageTokenHours } = await getOrCreateCache(
    client,
    model,
    systemPrompt,
    rollupJson,
    env,
  );

  // When using a cache the system instruction and tools are already stored server-side.
  const baseConfig = cacheName
    ? { cachedContent: cacheName }
    : { systemInstruction: systemPrompt, tools: [{ functionDeclarations: TOOL_DECLARATIONS }] };

  // Style is injected per-turn so it doesn't affect the shared model cache.
  const questionText = style ? `[Respond in this style: ${style}]\n\n${question}` : question;
  const contents: Content[] = [
    ...(priorHistory ?? []),
    { role: "user", parts: [{ text: questionText }] },
  ];

  const totalUsage: Usage = {
    prompt: 0,
    cached: 0,
    output: 0,
    cacheCreation: cacheCreationTokens,
    cacheStorageTokenHours,
  };
  let proposals: ProposedCommand[] = [];

  for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
    let response;
    try {
      response = await client.models.generateContent({ model, contents, config: baseConfig });
    } catch (err: unknown) {
      // If Gemini evicted the cache early, clear the stale KV entry and retry uncached.
      // The next request will recreate the cache.
      if (cacheName && String(err).includes("404")) {
        if (env.ASK_CACHE) await env.ASK_CACHE.delete(`cache:v2:${model}`).catch(() => {});
        response = await client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: systemPrompt,
            tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          },
        });
      } else {
        throw err;
      }
    }

    const meta = response.usageMetadata;
    if (meta) {
      totalUsage.prompt += meta.promptTokenCount ?? 0;
      totalUsage.cached += meta.cachedContentTokenCount ?? 0;
      totalUsage.output += meta.candidatesTokenCount ?? 0;
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
