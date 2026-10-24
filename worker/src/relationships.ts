import type {
  Env,
  Relationship,
  RelationshipDirection,
  RelationshipType,
  RelationshipsFile,
} from "./types";
import { type Replier } from "./telegram";
import { assertValidCode } from "./validation";
import { readJsonFile, writeJsonFile } from "./github/client";
import { RELATIONSHIPS_PATH } from "./github/paths";

export async function readRelationshipsFile(
  env: Env,
): Promise<{ file: RelationshipsFile; sha: string | null }> {
  const { data, sha } = await readJsonFile<Partial<RelationshipsFile>>(env, RELATIONSHIPS_PATH, {});
  return {
    file: {
      types: data.types ?? [],
      relationships: data.relationships ?? [],
    },
    sha,
  };
}

export async function writeRelationshipsFile(
  env: Env,
  file: RelationshipsFile,
  sha: string | null,
  commitMessage: string,
): Promise<void> {
  await writeJsonFile(env, RELATIONSHIPS_PATH, file, sha, commitMessage);
}

// ─── parsing helpers ───────────────────────────────────────────────────────

const DIRECTION_TOKENS = new Set(["f", "b", "u"]);

function parseDirection(token: string | undefined): RelationshipDirection | null {
  if (!token) return null;
  const lower = token.trim().toLowerCase();
  if (DIRECTION_TOKENS.has(lower)) return lower as RelationshipDirection;
  // Friendly aliases — accepted on input, normalized to the short codes.
  if (lower === "forward" || lower === "fwd") return "f";
  if (lower === "backward" || lower === "bwd" || lower === "reverse") return "b";
  if (lower === "undirected" || lower === "none") return "u";
  return null;
}

function nextRelationshipId(rels: Relationship[]): number {
  let max = 0;
  for (const r of rels) if (r.id > max) max = r.id;
  return max + 1;
}

// ─── pure mutators on RelationshipsFile (used by both direct & batch paths) ─

export interface RelateInput {
  typeId: string;
  from: string;
  to: string;
  direction?: string; // raw token from user input
}

export interface MutateResult {
  ok: boolean;
  reply: string;
  changed: boolean;
}

function ok(reply: string, changed = true): MutateResult {
  return { ok: true, reply, changed };
}
function fail(reply: string): MutateResult {
  return { ok: false, reply, changed: false };
}

export function applyRelate(file: RelationshipsFile, input: RelateInput): MutateResult {
  assertValidCode("shortCode", input.from);
  assertValidCode("shortCode", input.to);
  if (input.from === input.to) {
    return fail(`Cannot relate a plant to itself ("${input.from}").`);
  }
  const type = file.types.find((t) => t.id === input.typeId);
  if (!type) {
    const known = file.types.map((t) => t.id).join(", ") || "(none)";
    return fail(`Unknown relationship type "${input.typeId}". Known: ${known}. Add with /reltype.`);
  }
  let direction: RelationshipDirection | undefined;
  if (input.direction) {
    const parsed = parseDirection(input.direction);
    if (!parsed) return fail(`Invalid direction "${input.direction}". Use f, b, or u.`);
    // Omit when it matches the type's default to keep the file thrifty.
    if (parsed === "f" && type.directional) direction = undefined;
    else if (parsed === "u" && !type.directional) direction = undefined;
    else direction = parsed;
  }
  // Duplicate detection: same type + same unordered endpoints for undirected,
  // exact (from, to) match for directional.
  const dup = file.relationships.find((r) => {
    if (r.type !== input.typeId) return false;
    if (type.directional && (direction ?? "f") !== "u") {
      return r.from === input.from && r.to === input.to;
    }
    return (
      (r.from === input.from && r.to === input.to) || (r.from === input.to && r.to === input.from)
    );
  });
  if (dup) {
    return fail(`Relationship already exists: #${dup.id} ${input.typeId} ${dup.from}→${dup.to}.`);
  }
  const id = nextRelationshipId(file.relationships);
  const rel: Relationship = { id, type: input.typeId, from: input.from, to: input.to };
  if (direction) rel.direction = direction;
  file.relationships.push(rel);
  const arrow = direction === "u" || (!direction && !type.directional) ? "↔" : "→";
  return ok(`Related #${id}: ${rel.from} ${arrow} ${rel.to} (${type.name})`);
}

export function applyUnrelate(file: RelationshipsFile, idRaw: string): MutateResult {
  const id = parseInt(idRaw, 10);
  if (isNaN(id) || String(id) !== idRaw) {
    return fail(`Invalid relationship id "${idRaw}".`);
  }
  const idx = file.relationships.findIndex((r) => r.id === id);
  if (idx === -1) return fail(`No relationship found with id ${id}.`);
  const [removed] = file.relationships.splice(idx, 1);
  return ok(`Deleted relationship #${id}: ${removed.from} ↔ ${removed.to} (${removed.type})`);
}

export interface RelTypeInput {
  id: string;
  name: string;
  description: string;
  directional: boolean;
}

export function applyRelType(file: RelationshipsFile, input: RelTypeInput): MutateResult {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(input.id)) {
    return fail(
      `Invalid type id "${input.id}" — lowercase letters, digits, and hyphens; must start with a letter; max 32 chars.`,
    );
  }
  const existing = file.types.findIndex((t) => t.id === input.id);
  const entry: RelationshipType = {
    id: input.id,
    name: input.name.trim() || input.id,
    description: input.description.trim(),
    directional: input.directional,
  };
  if (existing === -1) {
    file.types.push(entry);
    return ok(
      `Added relationship type "${entry.id}" (${entry.directional ? "directional" : "undirected"}).`,
    );
  }
  file.types[existing] = entry;
  return ok(`Updated relationship type "${entry.id}".`);
}

// ─── format helpers ────────────────────────────────────────────────────────

export function formatRelationsFor(file: RelationshipsFile, shortCode: string): string {
  const typeById = new Map(file.types.map((t) => [t.id, t]));
  const rows = file.relationships.filter((r) => r.from === shortCode || r.to === shortCode);
  if (rows.length === 0) return `No relationships for ${shortCode}.`;
  const lines = rows.map((r) => {
    const t = typeById.get(r.type);
    const directional = r.direction ? r.direction !== "u" : (t?.directional ?? false);
    const arrow = directional ? (r.direction === "b" ? "←" : "→") : "↔";
    return `  #${r.id} ${r.from} ${arrow} ${r.to}  (${t?.name ?? r.type})`;
  });
  return `Relationships for ${shortCode}:\n${lines.join("\n")}`;
}

export function formatTypes(file: RelationshipsFile): string {
  if (file.types.length === 0) {
    return "No relationship types defined. Add one with /reltype.";
  }
  const lines = file.types.map(
    (t) =>
      `  ${t.id} (${t.directional ? "directional" : "undirected"}) — ${t.name}: ${t.description}`,
  );
  return `Relationship types:\n${lines.join("\n")}`;
}

// ─── direct (single-command) handlers used by commands.ts ──────────────────

function parseRelateCommand(rest: string): RelateInput | null {
  const parts = rest
    .trim()
    .split("//")
    .map((s) => s.trim());
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  const [typeId, from, to, direction] = parts;
  return { typeId, from, to, direction: direction || undefined };
}

export async function handleRelate(text: string, env: Env, reply: Replier): Promise<void> {
  const rest = text.slice("/relate".length).trim();
  const input = parseRelateCommand(rest);
  if (!input) {
    await reply("Usage: /relate <typeId> // <fromCode> // <toCode> [// f|b|u]");
    return;
  }
  const { file, sha } = await readRelationshipsFile(env);
  const result = applyRelate(file, input);
  if (!result.ok) {
    await reply(result.reply);
    return;
  }
  await writeRelationshipsFile(
    env,
    file,
    sha,
    `Add relationship: ${input.from} ↔ ${input.to} (${input.typeId})`,
  );
  await reply(result.reply);
}

export async function handleUnrelate(text: string, env: Env, reply: Replier): Promise<void> {
  const rest = text.slice("/unrelate".length).trim();
  const { file, sha } = await readRelationshipsFile(env);
  const result = applyUnrelate(file, rest);
  if (!result.ok) {
    await reply(result.reply);
    return;
  }
  await writeRelationshipsFile(env, file, sha, `Remove relationship #${rest}`);
  await reply(result.reply);
}

export async function handleRelations(text: string, env: Env, reply: Replier): Promise<void> {
  const rest = text.slice("/relations".length).trim();
  if (!rest) {
    await reply("Usage: /relations <shortCode>");
    return;
  }
  assertValidCode("shortCode", rest);
  const { file } = await readRelationshipsFile(env);
  await reply(formatRelationsFor(file, rest));
}

export async function handleRelTypes(env: Env, reply: Replier): Promise<void> {
  const { file } = await readRelationshipsFile(env);
  await reply(formatTypes(file));
}

// /reltype <id> // <name> // <description> // [directional|undirected]
export async function handleRelType(text: string, env: Env, reply: Replier): Promise<void> {
  const rest = text.slice("/reltype".length).trim();
  const parts = rest.split("//").map((s) => s.trim());
  if (parts.length < 3) {
    await reply(
      "Usage: /reltype <id> // <name> // <description> // [directional|undirected]\nDefault is undirected.",
    );
    return;
  }
  const [id, name, description, dirToken] = parts;
  const directional = (dirToken ?? "").toLowerCase() === "directional";
  const { file, sha } = await readRelationshipsFile(env);
  const result = applyRelType(file, { id, name, description, directional });
  if (!result.ok) {
    await reply(result.reply);
    return;
  }
  await writeRelationshipsFile(env, file, sha, `Add/update relationship type: ${id}`);
  await reply(result.reply);
}

// ─── batch-state helpers (for /confirm) ────────────────────────────────────

export function batchApplyRelate(
  state: { relationships: RelationshipsFile; dirty: Set<"relationships"> },
  rest: string,
): MutateResult {
  const input = parseRelateCommand(rest);
  if (!input) return fail("Usage: /relate <typeId> // <fromCode> // <toCode> [// f|b|u]");
  const r = applyRelate(state.relationships, input);
  if (r.changed) state.dirty.add("relationships");
  return r;
}

export function batchApplyUnrelate(
  state: { relationships: RelationshipsFile; dirty: Set<"relationships"> },
  rest: string,
): MutateResult {
  const r = applyUnrelate(state.relationships, rest.trim());
  if (r.changed) state.dirty.add("relationships");
  return r;
}

export function batchApplyRelType(
  state: { relationships: RelationshipsFile; dirty: Set<"relationships"> },
  rest: string,
): MutateResult {
  const parts = rest.split("//").map((s) => s.trim());
  if (parts.length < 3) {
    return fail("Usage: /reltype <id> // <name> // <description> // [directional|undirected]");
  }
  const [id, name, description, dirToken] = parts;
  const directional = (dirToken ?? "").toLowerCase() === "directional";
  const r = applyRelType(state.relationships, { id, name, description, directional });
  if (r.changed) state.dirty.add("relationships");
  return r;
}
