import type {
  Relationship,
  RelationshipDirection,
  RelationshipType,
  RelationshipsFile,
} from "../types";
import { isWritable, loadJson, notifyDataChanged } from "./source";
import { driveSaveJson } from "./driveSource";

/**
 * Browser write path for a Drive-backed garden's relationship graph
 * (`relationships.json`). Mirrors the pure mutators the Cloudflare worker runs
 * for Telegram's `/relate` · `/unrelate` · `/reltype` commands
 * (`worker/src/relationships.ts`) so both surfaces produce byte-compatible
 * files: same id allocation, dedup rule, and direction normalization.
 *
 * Each mutation re-reads the file before writing (cheap read-modify-write;
 * writes are already serialized through `driveSaveJson`'s queue).
 */

function assertWritable(): void {
  if (!isWritable()) throw new Error("The founder's garden is read-only");
}

const EMPTY: RelationshipsFile = { types: [], relationships: [] };

function loadFile(): Promise<RelationshipsFile> {
  return loadJson<RelationshipsFile>("relationships.json").then((f) => ({
    types: f.types ?? [],
    relationships: f.relationships ?? [],
  })).catch(() => ({ ...EMPTY, types: [], relationships: [] }));
}

function save(file: RelationshipsFile): Promise<void> {
  return driveSaveJson("relationships.json", file).then(notifyDataChanged);
}

function nextId(rels: Relationship[]): number {
  let max = 0;
  for (const r of rels) if (r.id > max) max = r.id;
  return max + 1;
}

/**
 * Collapse an explicit direction against a type's default so the stored file
 * stays thrifty — an omitted `direction` means "use the type default", matching
 * the worker. Returns `undefined` when the chosen direction *is* the default.
 */
function normalizeDirection(
  direction: RelationshipDirection | undefined,
  type: RelationshipType,
): RelationshipDirection | undefined {
  if (!direction) return undefined;
  if (direction === "f" && type.directional) return undefined;
  if (direction === "u" && !type.directional) return undefined;
  return direction;
}

/** Does an existing relationship duplicate the proposed one? Mirrors the worker. */
function isDuplicate(
  rels: Relationship[],
  typeId: string,
  from: string,
  to: string,
  direction: RelationshipDirection | undefined,
  type: RelationshipType,
  ignoreId?: number,
): boolean {
  return rels.some((r) => {
    if (r.id === ignoreId) return false;
    if (r.type !== typeId) return false;
    if (type.directional && (direction ?? "f") !== "u") {
      return r.from === from && r.to === to;
    }
    return (r.from === from && r.to === to) || (r.from === to && r.to === from);
  });
}

export interface AddRelationshipInput {
  typeId: string;
  from: string;
  to: string;
  /** Omit for the type's default orientation. */
  direction?: RelationshipDirection;
}

/** Create a relationship. Returns the new record. */
export async function addRelationship(input: AddRelationshipInput): Promise<Relationship> {
  assertWritable();
  if (input.from === input.to) throw new Error("An organism can't relate to itself.");
  const file = await loadFile();
  const type = file.types.find((t) => t.id === input.typeId);
  if (!type) throw new Error(`Unknown relationship type "${input.typeId}".`);

  const direction = normalizeDirection(input.direction, type);
  if (isDuplicate(file.relationships, input.typeId, input.from, input.to, direction, type)) {
    throw new Error(`That ${type.name} relationship already exists.`);
  }

  const rel: Relationship = {
    id: nextId(file.relationships),
    type: input.typeId,
    from: input.from,
    to: input.to,
  };
  if (direction) rel.direction = direction;

  file.relationships.push(rel);
  await save(file);
  return rel;
}

export interface UpdateRelationshipInput {
  typeId?: string;
  from?: string;
  to?: string;
  direction?: RelationshipDirection;
}

/** Edit an existing relationship's type / endpoints / direction. */
export async function updateRelationship(
  id: number,
  fields: UpdateRelationshipInput,
): Promise<void> {
  assertWritable();
  const file = await loadFile();
  const rel = file.relationships.find((r) => r.id === id);
  if (!rel) throw new Error(`Relationship #${id} not found.`);

  const typeId = fields.typeId ?? rel.type;
  const from = fields.from ?? rel.from;
  const to = fields.to ?? rel.to;
  if (from === to) throw new Error("An organism can't relate to itself.");
  const type = file.types.find((t) => t.id === typeId);
  if (!type) throw new Error(`Unknown relationship type "${typeId}".`);

  const rawDir = fields.direction !== undefined ? fields.direction : rel.direction;
  const direction = normalizeDirection(rawDir, type);
  if (isDuplicate(file.relationships, typeId, from, to, direction, type, id)) {
    throw new Error(`That ${type.name} relationship already exists.`);
  }

  rel.type = typeId;
  rel.from = from;
  rel.to = to;
  if (direction) rel.direction = direction;
  else delete rel.direction;

  await save(file);
}

/** Delete a relationship by id. No-ops if it's already gone. */
export async function deleteRelationship(id: number): Promise<void> {
  assertWritable();
  const file = await loadFile();
  const next = file.relationships.filter((r) => r.id !== id);
  if (next.length === file.relationships.length) return;
  await save({ ...file, relationships: next });
}

// ─── Relationship types ─────────────────────────────────────────────────────

const TYPE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Turn a human name into a valid type id (`[a-z][a-z0-9-]{0,31}`, leading
 * letter). Used to auto-derive an id when the user only types a display name.
 */
export function slugifyTypeId(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (!/^[a-z]/.test(s)) s = `t-${s}`.slice(0, 32).replace(/-+$/g, "");
  return s || "type";
}

export interface UpsertTypeInput {
  id: string;
  name: string;
  description?: string;
  directional: boolean;
}

/** Create or update a relationship type (keyed by id). Mirrors `/reltype`. */
export async function upsertRelationshipType(input: UpsertTypeInput): Promise<RelationshipType> {
  assertWritable();
  if (!TYPE_ID_RE.test(input.id)) {
    throw new Error(
      "Invalid type id — lowercase letters, digits and hyphens, must start with a letter (max 32).",
    );
  }
  const file = await loadFile();
  const entry: RelationshipType = {
    id: input.id,
    name: input.name.trim() || input.id,
    description: (input.description ?? "").trim(),
    directional: input.directional,
  };
  const idx = file.types.findIndex((t) => t.id === input.id);
  if (idx === -1) file.types.push(entry);
  else file.types[idx] = entry;
  await save(file);
  return entry;
}

/**
 * Delete a relationship type. By default refuses if any relationship still uses
 * it (throws with the count); pass `cascade` to also drop those relationships.
 */
export async function deleteRelationshipType(id: string, cascade = false): Promise<void> {
  assertWritable();
  const file = await loadFile();
  const inUse = file.relationships.filter((r) => r.type === id).length;
  if (inUse > 0 && !cascade) {
    throw new Error(
      `${inUse} relationship${inUse === 1 ? "" : "s"} still use this type. Delete them first.`,
    );
  }
  await save({
    types: file.types.filter((t) => t.id !== id),
    relationships: cascade ? file.relationships.filter((r) => r.type !== id) : file.relationships,
  });
}

// ─── Batch command application (AI-assist path) ─────────────────────────────
//
// A model, given the garden rollup + command grammar, replies with a list of
// `/reltype` and `/relate` commands. We parse them (see `relationshipAI.ts`)
// into `RelCommand`s and apply the whole batch here in one read-modify-write —
// the same semantics the Cloudflare worker's `/confirm` runs for Telegram.

export type RelCommand =
  | { kind: "reltype"; id: string; name: string; description: string; directional: boolean; raw: string }
  | {
      kind: "relate";
      typeId: string;
      from: string;
      to: string;
      direction?: RelationshipDirection;
      raw: string;
    }
  | { kind: "unrelate"; id: number; raw: string };

export interface CommandResult {
  raw: string;
  ok: boolean;
  message: string;
}

/**
 * Apply a batch of parsed relationship commands in order, then persist once.
 * Each command succeeds or fails independently (a bad line never aborts the
 * batch). When `knownCodes` is supplied, `/relate` endpoints must be real
 * organism shortCodes — this guards against a model hallucinating a code.
 */
export async function applyRelationshipCommands(
  commands: RelCommand[],
  knownCodes?: Set<string>,
): Promise<CommandResult[]> {
  assertWritable();
  const file = await loadFile();
  const results: CommandResult[] = [];
  let changed = false;

  for (const c of commands) {
    try {
      if (c.kind === "reltype") {
        if (!TYPE_ID_RE.test(c.id)) throw new Error(`Invalid type id "${c.id}".`);
        const entry: RelationshipType = {
          id: c.id,
          name: c.name.trim() || c.id,
          description: c.description.trim(),
          directional: c.directional,
        };
        const idx = file.types.findIndex((t) => t.id === c.id);
        if (idx === -1) {
          file.types.push(entry);
          results.push({ raw: c.raw, ok: true, message: `Added type "${entry.name}"` });
        } else {
          file.types[idx] = entry;
          results.push({ raw: c.raw, ok: true, message: `Updated type "${entry.name}"` });
        }
        changed = true;
      } else if (c.kind === "relate") {
        if (c.from === c.to) throw new Error("An organism can't relate to itself.");
        if (knownCodes && !knownCodes.has(c.from)) throw new Error(`Unknown organism "${c.from}".`);
        if (knownCodes && !knownCodes.has(c.to)) throw new Error(`Unknown organism "${c.to}".`);
        const type = file.types.find((t) => t.id === c.typeId);
        if (!type) throw new Error(`Unknown relationship type "${c.typeId}".`);
        const direction = normalizeDirection(c.direction, type);
        if (isDuplicate(file.relationships, c.typeId, c.from, c.to, direction, type)) {
          throw new Error(`That ${type.name} relationship already exists.`);
        }
        const rel: Relationship = {
          id: nextId(file.relationships),
          type: c.typeId,
          from: c.from,
          to: c.to,
        };
        if (direction) rel.direction = direction;
        file.relationships.push(rel);
        const arrow = direction === "u" || (!direction && !type.directional) ? "↔" : "→";
        results.push({
          raw: c.raw,
          ok: true,
          message: `${c.from} ${arrow} ${c.to} (${type.name})`,
        });
        changed = true;
      } else {
        const before = file.relationships.length;
        file.relationships = file.relationships.filter((r) => r.id !== c.id);
        if (file.relationships.length === before) throw new Error(`No relationship #${c.id}.`);
        results.push({ raw: c.raw, ok: true, message: `Deleted relationship #${c.id}` });
        changed = true;
      }
    } catch (err) {
      results.push({
        raw: c.raw,
        ok: false,
        message: err instanceof Error ? err.message : "Failed",
      });
    }
  }

  if (changed) await save(file);
  return results;
}
