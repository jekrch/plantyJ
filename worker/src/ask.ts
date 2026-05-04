import { GoogleGenAI, Type } from "@google/genai";
import type { Env } from "./types";
import { HELP_HEADER } from "./help";

const MAX_TOOL_ITERATIONS = 3;
const TELEGRAM_MAX_LEN = 4096;
const CACHE_TTL_SECONDS = 30 * 24 * 3600; // 30 days; recreated only when rollup checksum changes
// /ask  = /ask3, /ask1 = lite (cheap), /ask3 = pro preview (best)
export const MODEL_ALIASES: Record<string, string> = {
  "1": "gemini-3.1-flash-lite-preview",
  "2": "gemini-2.5-pro",
  "3": "gemini-3.1-pro-preview",
};

// $/1M tokens: uncached input, cached input, output (approximate — verify at ai.google.dev/pricing)
const MODEL_PRICING: Record<string, { i: number; c: number; o: number }> = {
  "gemini-3.1-flash-lite-preview": { i: 0.10,  c: 0.025, o: 0.40  },
  "gemini-2.5-pro":                { i: 1.25,  c: 0.315, o: 10.00 },
  "gemini-3.1-pro-preview":        { i: 1.25,  c: 0.315, o: 10.00 },
};

type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: unknown };
type Content = { role: string; parts: Part[] };

export interface Thread {
  model: string;
  history: Content[];
}

interface CacheState {
  checksum: string;
  cacheName: string;
  expiresAt: number;
}

interface Usage {
  prompt: number;
  cached: number;
  output: number;
  cacheCreation: number;
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
  const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const res = await fetch(`${base}/species/${slug}.json`, {
    cf: { cacheTtl: 60, cacheEverything: true } as RequestInitCfProperties,
  });
  if (res.status === 404) return `No species record found for "${fullName}".`;
  if (!res.ok) throw new Error(`Failed to fetch species ${slug}: ${res.status}`);
  return res.text();
}

function buildSystemPrompt(rollupJson: string): string {
  return `You are the PlantyJ garden-journal assistant. The user keeps a private photo journal of plants, animals, and zones at their home in Minneapolis, MN (USDA hardiness zone 4b/5a). The property sits on the northwest corner of a city block with clay/loam soil. The gardeners prioritize native plants, edibles, medicinals, and supporting local ecology. Answer their questions factually from the data below, and when they want to add or change data, suggest copy-pasteable bot commands they can send to this same Telegram chat.

# Bot command reference (the user will copy these verbatim)
${HELP_HEADER}

# Garden rollup (precomputed, plant-centric)
# Schema:
#   zones[]:  { code, name, hasZonePic }
#   plants[]: { shortCode, fullName, commonName, variety?, kind?,
#               tags[], description,
#               byZone: { <zoneCode>: { tags[], description } },
#               pics[]: { seq, zone, tags[], description, by, at },
#               picCount, zonesSeen[], lastSeenAt, firstSeenAt }
#   orphanPics[]: pics whose shortCode no longer maps to a plant
# pics[] is newest-first. "kind" is omitted when "plant".
${rollupJson}

# Calling get_species
# To answer questions about taxonomy, native range, or anything from Wikipedia, call get_species with a plant's fullName. Returns nativeRange (often null), description, taxonomy, vernacularNames.

# Behavior rules
- When asked about coverage gaps (untagged, missing zone pic, etc.), list affected plants and emit one suggested command per plant.
- When suggesting a photo caption, use the canonical format:
    shortCode // fullName // commonName // Zone (code) // tags // description
- For native-range questions, prefer get_species() over guessing. If nativeRange is null, fall back to the species description text.
- When suggesting /delete, /update, /addtag {seq} etc., always use the seq from the rollup — never invent one.
- Never claim to have executed a command. You are read-only; the user will copy and send commands themselves.
- Reply in plain text, no Markdown. Telegram replies are 4096 chars max — keep it tight.`;
}

function truncateForTelegram(text: string): string {
  if (text.length <= TELEGRAM_MAX_LEN) return text;
  const cutoff = text.lastIndexOf("\n", TELEGRAM_MAX_LEN - 30);
  const pos = cutoff > TELEGRAM_MAX_LEN / 2 ? cutoff : TELEGRAM_MAX_LEN - 30;
  return text.slice(0, pos) + "\n[...truncated]";
}

function formatCost(model: string, usage: Usage): string {
  const p = MODEL_PRICING[model];
  if (!p) return "";
  const uncached = usage.prompt - usage.cached;
  const cost =
    (uncached * p.i + usage.cached * p.c + usage.output * p.o + usage.cacheCreation * p.i) /
    1_000_000;
  const costStr = cost < 0.0001 ? "<$0.0001" : `$${cost.toFixed(4)}`;
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

// Returns a valid Gemini cache name from KV, or creates+stores a new one.
// Falls back to undefined on any error so callers can proceed without caching.
async function getOrCreateCache(
  client: GoogleGenAI,
  model: string,
  systemPrompt: string,
  rollupJson: string,
  env: Env
): Promise<{ cacheName: string | undefined; cacheCreationTokens: number }> {
  if (!env.ASK_CACHE) return { cacheName: undefined, cacheCreationTokens: 0 };
  try {
    const checksum = await computeChecksum(rollupJson);
    const kvKey = `cache:${model}`;
    const raw = await env.ASK_CACHE.get(kvKey);

    if (raw) {
      const state: CacheState = JSON.parse(raw);
      if (state.checksum === checksum && state.expiresAt > Date.now()) {
        return { cacheName: state.cacheName, cacheCreationTokens: 0 };
      }
    }

    // Create a new Gemini context cache with the static parts of the prompt.
    // The model path must use the full resource name for the caching API.
    const cache = await client.caches.create({
      model: model.startsWith("models/") ? model : `models/${model}`,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: [GET_SPECIES_DECLARATION] }],
        ttl: `${CACHE_TTL_SECONDS}s`,
      },
    });

    const state: CacheState = {
      checksum,
      cacheName: cache.name!,
      expiresAt: Date.now() + (CACHE_TTL_SECONDS - 60) * 1000,
    };
    await env.ASK_CACHE.put(kvKey, JSON.stringify(state), {
      expirationTtl: CACHE_TTL_SECONDS,
    });

    const creationTokens = (cache.usageMetadata as { totalTokenCount?: number } | undefined)?.totalTokenCount ?? 0;
    return { cacheName: cache.name!, cacheCreationTokens: creationTokens };
  } catch {
    // Caching is best-effort; any failure falls back to uncached.
    return { cacheName: undefined, cacheCreationTokens: 0 };
  }
}

export async function answerQuestion(
  question: string,
  env: Env,
  modelOverride?: string,
  priorHistory?: Content[],
  style?: string
): Promise<{ reply: string; thread: Thread }> {
  const rollupJson = await loadRollup(env);
  const model = modelOverride ?? env.LLM_MODEL ?? MODEL_ALIASES["2"];
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const systemPrompt = buildSystemPrompt(rollupJson);

  const { cacheName, cacheCreationTokens } = await getOrCreateCache(client, model, systemPrompt, rollupJson, env);

  // When using a cache the system instruction and tools are already stored server-side.
  const baseConfig = cacheName
    ? { cachedContent: cacheName }
    : { systemInstruction: systemPrompt, tools: [{ functionDeclarations: [GET_SPECIES_DECLARATION] }] };

  // Style is injected per-turn so it doesn't affect the shared model cache.
  const questionText = style ? `[Respond in this style: ${style}]\n\n${question}` : question;
  const contents: Content[] = [...(priorHistory ?? []), { role: "user", parts: [{ text: questionText }] }];

  const totalUsage: Usage = { prompt: 0, cached: 0, output: 0, cacheCreation: cacheCreationTokens };

  for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
    let response;
    try {
      response = await client.models.generateContent({ model, contents, config: baseConfig });
    } catch (err: unknown) {
      // If Gemini evicted the cache early, clear the stale KV entry and retry uncached.
      // The next request will recreate the cache.
      if (cacheName && String(err).includes("404")) {
        if (env.ASK_CACHE) await env.ASK_CACHE.delete(`cache:${model}`).catch(() => {});
        response = await client.models.generateContent({
          model,
          contents,
          config: { systemInstruction: systemPrompt, tools: [{ functionDeclarations: [GET_SPECIES_DECLARATION] }] },
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

    if (calls.length === 0 || i === MAX_TOOL_ITERATIONS) {
      contents.push({ role: "model", parts });
      const text = parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("\n")
        .trim();
      const costLine = formatCost(model, totalUsage);
      const body = truncateForTelegram(text || "No response.");
      const reply = costLine ? `${body}\n${costLine}` : body;
      return { reply, thread: { model, history: contents } };
    }

    contents.push({ role: "model", parts });

    const results: Part[] = await Promise.all(
      calls.map(async (p) => {
        const { name, args } = p.functionCall!;
        const result =
          name === "get_species"
            ? await getSpecies(args.fullName as string, env)
            : `Unknown tool: ${name}`;
        return { functionResponse: { name, response: { result } } };
      })
    );

    contents.push({ role: "user", parts: results });
  }

  return { reply: "Could not generate a response.", thread: { model, history: contents } };
}
