import type {
  Annotation,
  OrganismRecord,
  PicRecord,
  RelationshipDirection,
  RelationshipsFile,
  Zone,
  ZonePic,
} from "../types";
import { loadJson } from "./source";
import type { RelCommand } from "./relationshipMutations";

/**
 * Client-side "AI assist" for relationship building. Produces a self-contained
 * prompt — the garden **rollup** plus the exact `/relate` · `/reltype` command
 * grammar — that the user pastes into any chat model. The model replies with a
 * list of commands, which `parseRelationshipCommands` turns back into
 * `RelCommand`s for `applyRelationshipCommands` to execute.
 *
 * The rollup mirrors `scripts/build-rollup.py` (the plant-centric summary the
 * Telegram bot feeds Gemini) so both surfaces reason over the same shape.
 */

// ─── Rollup ─────────────────────────────────────────────────────────────────

interface CompactPic {
  seq: number;
  zone?: string;
  tags?: string[];
  description?: string;
  at?: string;
}

interface RollupPlant {
  shortCode: string;
  fullName?: string;
  commonName?: string;
  variety?: string;
  kind?: "animal";
  tags?: string[];
  description?: string;
  byZone?: Record<string, { tags?: string[]; description?: string; removed?: true }>;
  pics: CompactPic[];
  picCount: number;
  zonesSeen: string[];
  lastSeenAt?: string;
  firstSeenAt?: string;
}

export interface GardenRollup {
  generatedAt: string;
  zones: Array<{ code: string; name?: string; hasZonePic?: true; description?: string }>;
  plants: RollupPlant[];
  orphanPics: Array<{ shortCode: string } & CompactPic>;
  relationships: {
    types: Array<{ id: string; name: string; description?: string; directional?: true }>;
    edges: Array<[number, string, string, string, RelationshipDirection | undefined]>;
  };
}

const day = (ts: string | null | undefined): string | null => (ts ? ts.slice(0, 10) : null);

function compactPic(pic: PicRecord): CompactPic {
  const rec: CompactPic = { seq: pic.seq };
  if (pic.zoneCode) rec.zone = pic.zoneCode;
  if (pic.tags?.length) rec.tags = pic.tags;
  if (pic.description) rec.description = pic.description;
  const at = day(pic.addedAt);
  if (at) rec.at = at;
  return rec;
}

/** Build the garden rollup from the current data source (Drive or static). */
export async function buildRollup(): Promise<GardenRollup> {
  const [picsF, plantsF, zonesF, zonePicsF, annF, relF] = await Promise.all([
    loadJson<{ pics?: PicRecord[] }>("pics.json"),
    loadJson<{ plants?: OrganismRecord[] }>("plants.json"),
    loadJson<{ zones?: Zone[] }>("zones.json"),
    loadJson<{ zonePics?: ZonePic[] }>("zone_pics.json"),
    loadJson<{ annotations?: Annotation[] }>("annotations.json"),
    loadJson<RelationshipsFile>("relationships.json").catch(() => ({
      types: [],
      relationships: [],
    })),
  ]);

  const plantsRaw = plantsF.plants ?? [];
  const picsRaw = picsF.pics ?? [];
  const zonesRaw = zonesF.zones ?? [];
  const zonePicsRaw = zonePicsF.zonePics ?? [];
  const annotationsRaw = annF.annotations ?? [];

  const zonesWithPics = new Set(zonePicsRaw.map((zp) => zp.zoneCode));
  const zones = zonesRaw
    .map((z) => ({
      code: z.code,
      ...(z.name ? { name: z.name } : {}),
      ...(zonesWithPics.has(z.code) ? { hasZonePic: true as const } : {}),
      ...(z.description ? { description: z.description } : {}),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const plantCodes = new Set(plantsRaw.map((p) => p.shortCode));

  const annByPlant = new Map<
    string,
    { plant: Annotation | null; byZone: Map<string, Annotation> }
  >();
  for (const a of annotationsRaw) {
    let bucket = annByPlant.get(a.shortCode);
    if (!bucket) {
      bucket = { plant: null, byZone: new Map() };
      annByPlant.set(a.shortCode, bucket);
    }
    if (a.zoneCode == null) bucket.plant = a;
    else bucket.byZone.set(a.zoneCode, a);
  }

  const picsByPlant = new Map<string, PicRecord[]>();
  const orphanPics: Array<{ shortCode: string } & CompactPic> = [];
  for (const pic of picsRaw) {
    if (!plantCodes.has(pic.shortCode)) {
      orphanPics.push({ shortCode: pic.shortCode, ...compactPic(pic) });
    } else {
      const arr = picsByPlant.get(pic.shortCode);
      if (arr) arr.push(pic);
      else picsByPlant.set(pic.shortCode, [pic]);
    }
  }

  const plants: RollupPlant[] = [];
  for (const p of [...plantsRaw].sort((a, b) => a.shortCode.localeCompare(b.shortCode))) {
    const sc = p.shortCode;
    const rawPics = (picsByPlant.get(sc) ?? []).sort((a, b) =>
      (b.addedAt ?? "").localeCompare(a.addedAt ?? ""),
    );

    const ann = annByPlant.get(sc);
    const plantAnn = ann?.plant;
    const byZone: RollupPlant["byZone"] = {};
    for (const [zc, za] of [...(ann?.byZone ?? new Map())].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const entry: { tags?: string[]; description?: string; removed?: true } = {};
      if (za.tags?.length) entry.tags = za.tags;
      if (za.description) entry.description = za.description;
      if (za.removed) entry.removed = true;
      byZone[zc] = entry;
    }

    const compactPics = rawPics.map(compactPic);
    const zonesSeen = [...new Set(compactPics.map((c) => c.zone).filter(Boolean))].sort() as string[];
    const dates = compactPics.map((c) => c.at).filter(Boolean) as string[];
    const isAnimal = rawPics.some((pic) => pic.kind === "animal");

    const record: RollupPlant = {
      shortCode: sc,
      ...(p.fullName ? { fullName: p.fullName } : {}),
      ...(p.commonName ? { commonName: p.commonName } : {}),
      ...(p.variety ? { variety: p.variety } : {}),
      ...(isAnimal ? { kind: "animal" as const } : {}),
      ...(plantAnn?.tags?.length ? { tags: plantAnn.tags } : {}),
      ...(plantAnn?.description ? { description: plantAnn.description } : {}),
      ...(Object.keys(byZone).length ? { byZone } : {}),
      pics: compactPics,
      picCount: compactPics.length,
      zonesSeen,
    };
    if (dates.length) {
      record.lastSeenAt = dates.reduce((m, d) => (d > m ? d : m));
      record.firstSeenAt = dates.reduce((m, d) => (d < m ? d : m));
    }
    plants.push(record);
  }

  const types = (relF.types ?? []).map((t) => ({
    id: t.id,
    name: t.name ?? t.id,
    ...(t.description ? { description: t.description } : {}),
    ...(t.directional ? { directional: true as const } : {}),
  }));
  const edges = (relF.relationships ?? []).map(
    (r) => [r.id, r.type, r.from, r.to, r.direction] as GardenRollup["relationships"]["edges"][number],
  );

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    zones,
    plants,
    orphanPics,
    relationships: { types, edges },
  };
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

/**
 * Compose the model prompt: task framing + command grammar + the rollup JSON.
 * The reply is parsed by `parseRelationshipCommands`, so the output contract
 * (a fenced block of `/relate` · `/reltype` lines, no prose) matters.
 */
export function buildRelationshipPrompt(rollup: GardenRollup): string {
  const rollupJson = JSON.stringify(rollup);
  return `You are a garden-ecology assistant helping map the relationships between organisms in a personal garden journal. Below is a JSON "rollup" of the garden: its plants and animals (each with a \`shortCode\` id, names, and where/when it was seen), plus the relationship types and edges that already exist.

Your job: propose ecological relationships **between organisms that already exist in the rollup** — pollination, companion planting, predation, competition, provides-habitat/food, shade, nitrogen-fixing neighbours, etc. Ground every proposal in the actual organisms present; do not invent species that aren't in \`plants[]\`.

## Output contract (read carefully)
Reply with **only** a fenced code block containing one command per line — no prose, no numbering, no comments. Use these two commands:

- Create a relationship type (only if no existing type fits):
  \`/reltype <id> // <name> // <description> // <directional|undirected>\`
  - \`<id>\`: lowercase letters, digits and hyphens, starting with a letter (e.g. \`pollinates\`).
  - Use \`directional\` when order matters (A pollinates B, A eats B); \`undirected\` for mutual links (companions).

- Create a relationship:
  \`/relate <typeId> // <fromCode> // <toCode> // <f|b|u>\`
  - \`<typeId>\`: an exact id from \`relationships.types[]\` **or** one you created with \`/reltype\` earlier in the same block.
  - \`<fromCode>\` / \`<toCode>\`: exact \`shortCode\` values copied verbatim from \`plants[]\` (they may contain spaces).
  - Direction is optional: \`f\` = from→to (default for directional types), \`b\` = to→from, \`u\` = undirected. Omit the last \`//\` field to use the type default.

Rules:
- Put any \`/reltype\` you need **before** the \`/relate\` lines that use it.
- Only use \`shortCode\`s that appear in the rollup. Never abbreviate or rename them.
- Don't repeat a relationship that already exists in \`relationships.edges\` (each edge is \`[id, typeId, from, to, direction]\`).
- Prefer existing types before creating new ones.

## Example output
\`\`\`
/reltype pollinates // Pollinates // Insect pollinates a flowering plant // directional
/relate pollinates // honeybee // borage // f
/relate companion // tomato // basil // u
\`\`\`

## Garden rollup
\`\`\`json
${rollupJson}
\`\`\``;
}

// ─── Response parsing ───────────────────────────────────────────────────────

export interface ParseResult {
  commands: RelCommand[];
  errors: Array<{ raw: string; error: string }>;
}

function parseDirection(token: string | undefined): RelationshipDirection | undefined {
  if (!token) return undefined;
  const t = token.trim().toLowerCase();
  if (t === "f" || t === "forward" || t === "fwd") return "f";
  if (t === "b" || t === "backward" || t === "bwd" || t === "reverse") return "b";
  if (t === "u" || t === "undirected" || t === "none") return "u";
  return undefined;
}

/**
 * Extract `/relate` · `/reltype` · `/unrelate` commands from a model reply.
 * Tolerates code fences and list markers (`- `, `1. `); ignores prose lines.
 * Lines that start with a slash but don't parse are reported as errors.
 */
export function parseRelationshipCommands(text: string): ParseResult {
  const commands: RelCommand[] = [];
  const errors: Array<{ raw: string; error: string }> = [];

  for (const rawLine of text.split("\n")) {
    // Strip code-fence rows and common list markers, then normalise.
    let line = rawLine.trim();
    if (!line || line.startsWith("```")) continue;
    line = line.replace(/^(?:[-*]|\d+[.)])\s+/, "").trim();
    line = line.replace(/^`+|`+$/g, "").trim();
    if (!line.startsWith("/")) continue;

    if (line.startsWith("/reltype")) {
      const parts = line
        .slice("/reltype".length)
        .split("//")
        .map((s) => s.trim());
      const id = parts[0] ?? "";
      if (!id) {
        errors.push({ raw: line, error: "Missing type id" });
        continue;
      }
      commands.push({
        kind: "reltype",
        id,
        name: parts[1] || id,
        description: parts[2] || "",
        directional: (parts[3] ?? "").toLowerCase() === "directional",
        raw: line,
      });
    } else if (line.startsWith("/relate")) {
      const parts = line
        .slice("/relate".length)
        .split("//")
        .map((s) => s.trim());
      const [typeId, from, to, dir] = parts;
      if (!typeId || !from || !to) {
        errors.push({ raw: line, error: "Expected /relate <typeId> // <from> // <to> [// f|b|u]" });
        continue;
      }
      commands.push({
        kind: "relate",
        typeId,
        from,
        to,
        direction: parseDirection(dir),
        raw: line,
      });
    } else if (line.startsWith("/unrelate")) {
      const m = line.match(/^\/unrelate\s+(\d+)/);
      if (!m) {
        errors.push({ raw: line, error: "Expected /unrelate <id>" });
        continue;
      }
      commands.push({ kind: "unrelate", id: parseInt(m[1], 10), raw: line });
    } else {
      errors.push({ raw: line, error: "Unrecognised command" });
    }
  }

  return { commands, errors };
}
