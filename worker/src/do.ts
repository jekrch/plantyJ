import { GoogleGenAI, Type } from "@google/genai";
import type { Env } from "./types";
import { HELP_HEADER } from "./help";

const MAX_TOOL_ITERATIONS = 4;
const TELEGRAM_MAX_LEN = 4096;

// /do uses the same model tier as /ask3 — proposing actions benefits from the
// stronger model since misparses become incorrect commits.
const DO_MODEL = "gemini-3.1-pro-preview";

type Part = {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: unknown;
};
type Content = { role: string; parts: Part[] };

export interface ProposedCommand {
  command: string;
  rationale: string;
}

export interface ProposeResult {
  summary: string;
  proposals: ProposedCommand[];
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
] as const;

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
  const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
  return `You are the PlantyJ garden-journal action agent. The user keeps a private photo journal of plants, animals, and zones at their home in Minneapolis, MN (USDA hardiness zone 4b/5a). They will describe a change they want to make in natural language; your job is to translate that into a list of bot commands and call the propose_commands tool with them. The user will then confirm or skip individual proposals — you do NOT execute anything yourself.

# Bot command reference (these are the verbs you will propose)
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
${rollupJson}

# Calling get_species
# Use get_species(fullName) to look up taxonomy / native range / Wikipedia summary before proposing fullName / commonName changes you aren't sure about.

# Calling propose_commands
# When you've decided on the changes, call propose_commands ONCE with the full list. Each proposal is { command, rationale }.
# - command: the literal slash command, exactly as the user would type it (no leading whitespace, no trailing newline)
# - rationale: a short (one-line) explanation of why this command, referencing concrete data from the rollup
# The user sees the list and chooses which to run. After calling propose_commands, also send a one-paragraph summary as plain text describing what you're proposing and any caveats.

# Allowed verbs (anything else will be rejected)
${verbList}
# /deletezone is intentionally excluded — recommend it in prose if needed and the user will run it manually.

# Hard rules
- Never invent seq numbers, shortCodes, or zoneCodes. They must come from the rollup.
- For /update, the field must be one of: shortCode, fullName, commonName, zoneCode, tags, description.
- For /addtag with a numeric first arg, that number is a pic seq from the rollup.
- Do not propose duplicate commands. Do not propose commands that would be no-ops (e.g. adding a tag that is already present).
- If the request is ambiguous or you have no good proposal, call propose_commands with an empty list and explain why in the summary.
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

const PROPOSE_COMMANDS_DECLARATION = {
  name: "propose_commands",
  description:
    "Submit the final list of bot commands for the user to confirm. Call this exactly once. After this tool call, also emit a short plain-text summary.",
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

export async function proposeActions(
  question: string,
  env: Env,
  style?: string
): Promise<ProposeResult> {
  const rollupJson = await loadRollup(env);
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const systemPrompt = buildSystemPrompt(rollupJson);

  const baseConfig = {
    systemInstruction: systemPrompt,
    tools: [
      {
        functionDeclarations: [GET_SPECIES_DECLARATION, PROPOSE_COMMANDS_DECLARATION],
      },
    ],
  };

  const questionText = style ? `[Respond in this style: ${style}]\n\n${question}` : question;
  const contents: Content[] = [{ role: "user", parts: [{ text: questionText }] }];

  let proposals: ProposedCommand[] | null = null;
  let lastModelText = "";

  for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
    const response = await client.models.generateContent({
      model: DO_MODEL,
      contents,
      config: baseConfig,
    });
    const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    const textHere = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (textHere) lastModelText = textHere;

    if (calls.length === 0 || i === MAX_TOOL_ITERATIONS) {
      contents.push({ role: "model", parts });
      break;
    }

    contents.push({ role: "model", parts });

    const proposeCall = calls.find((p) => p.functionCall?.name === "propose_commands");
    if (proposeCall) {
      proposals = sanitizeProposals(
        (proposeCall.functionCall!.args as { commands?: unknown }).commands
      );
      // Tell the model the list was recorded and ask for the summary text.
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "propose_commands",
              response: {
                result: `Recorded ${proposals.length} proposal(s). Reply with a short plain-text summary for the user (no further tool calls).`,
              },
            },
          },
        ],
      });
      // Run one more iteration to collect the summary, then stop.
      const followup = await client.models.generateContent({
        model: DO_MODEL,
        contents,
        config: baseConfig,
      });
      const fparts: Part[] = followup.candidates?.[0]?.content?.parts ?? [];
      const ftext = fparts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("\n")
        .trim();
      if (ftext) lastModelText = ftext;
      break;
    }

    // Otherwise these are get_species (or unknown) calls — answer them and loop.
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

  return {
    summary: truncateForTelegram(lastModelText || "(no summary)"),
    proposals: proposals ?? [],
  };
}
