import { GoogleGenAI, Type } from "@google/genai";
import type { Env } from "./types";
import { HELP_HEADER } from "./help";

const MAX_TOOL_ITERATIONS = 3;
const TELEGRAM_MAX_LEN = 4096;

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
  Use the "animal //" prefix for non-plants.
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

export async function answerQuestion(question: string, env: Env): Promise<string> {
  const rollupJson = await loadRollup(env);
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const model = env.LLM_MODEL ?? "gemini-2.5-flash";
  const systemInstruction = buildSystemPrompt(rollupJson);
  const tools = [{ functionDeclarations: [GET_SPECIES_DECLARATION] }];

  type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: unknown };
  type Content = { role: string; parts: Part[] };
  const contents: Content[] = [{ role: "user", parts: [{ text: question }] }];

  for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
    const response = await client.models.generateContent({
      model,
      contents,
      config: { systemInstruction, tools },
    });

    const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length === 0 || i === MAX_TOOL_ITERATIONS) {
      const text = parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("\n")
        .trim();
      return truncateForTelegram(text || "No response.");
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

  return "Could not generate a response.";
}
