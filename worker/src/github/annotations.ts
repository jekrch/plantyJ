import type { AnnotationEntry, Env } from "../types";
import { readJsonFile, writeJsonFile } from "./client";
import { parseList } from "./fields";
import { ANNOTATIONS_PATH } from "./paths";

// An annotation row carries information — and is worth persisting — if it has
// tags, a description, or a `removed` flag. Rows that hold none of these are
// pruned on write. Exported so the batch path applies the identical rule.
export function annotationHasContent(a: AnnotationEntry): boolean {
  return a.tags.length > 0 || a.description !== null || a.removed === true;
}

/** Annotations are keyed by the plant+zone pair; a null zone is the plant-wide row. */
function findIndex(
  annotations: AnnotationEntry[],
  shortCode: string,
  zoneCode: string | null,
): number {
  return annotations.findIndex((a) => a.shortCode === shortCode && a.zoneCode === zoneCode);
}

async function readFile(env: Env): Promise<{ annotations: AnnotationEntry[]; sha: string | null }> {
  const { data, sha } = await readJsonFile<{ annotations?: AnnotationEntry[] }>(
    env,
    ANNOTATIONS_PATH,
    { annotations: [] },
  );
  return { annotations: data.annotations ?? [], sha };
}

async function writeFile(
  env: Env,
  annotations: AnnotationEntry[],
  sha: string | null,
  message: string,
): Promise<void> {
  await writeJsonFile(env, ANNOTATIONS_PATH, { annotations }, sha, message);
}

function scopeOf(shortCode: string, zoneCode: string | null): string {
  return zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
}

export async function readAnnotations(env: Env): Promise<AnnotationEntry[]> {
  const { annotations } = await readFile(env);
  return annotations;
}

export async function upsertAnnotation(
  env: Env,
  shortCode: string,
  zoneCode: string | null,
  field: "tags" | "description",
  value: string,
): Promise<AnnotationEntry> {
  const { annotations, sha } = await readFile(env);
  const idx = findIndex(annotations, shortCode, zoneCode);

  let entry: AnnotationEntry;
  if (idx === -1) {
    entry = { shortCode, zoneCode, tags: [], description: null };
    annotations.push(entry);
  } else {
    entry = annotations[idx];
  }

  if (field === "tags") {
    entry.tags = parseList(value);
  } else {
    entry.description = value.trim() || null;
  }

  if (idx !== -1) annotations[idx] = entry;

  // Drop entries that carry no information.
  const cleaned = annotations.filter(annotationHasContent);

  await writeFile(env, cleaned, sha, `Annotate ${scopeOf(shortCode, zoneCode)}: ${field}`);

  return entry;
}

export async function addAnnotationTag(
  env: Env,
  shortCode: string,
  zoneCode: string | null,
  tag: string,
): Promise<{ entry: AnnotationEntry; added: boolean }> {
  const { annotations, sha } = await readFile(env);
  const idx = findIndex(annotations, shortCode, zoneCode);

  let entry: AnnotationEntry;
  if (idx === -1) {
    entry = { shortCode, zoneCode, tags: [tag], description: null };
    annotations.push(entry);
  } else {
    entry = annotations[idx];
    if (entry.tags.includes(tag)) return { entry, added: false };
    entry = { ...entry, tags: [...entry.tags, tag] };
    annotations[idx] = entry;
  }

  await writeFile(env, annotations, sha, `Add tag to ${scopeOf(shortCode, zoneCode)}: ${tag}`);
  return { entry, added: true };
}

export async function removeAnnotationTag(
  env: Env,
  shortCode: string,
  zoneCode: string | null,
  tag: string,
): Promise<{ entry: AnnotationEntry | null; removed: boolean }> {
  const { annotations, sha } = await readFile(env);
  const idx = findIndex(annotations, shortCode, zoneCode);
  if (idx === -1) return { entry: null, removed: false };

  const existing = annotations[idx];
  if (!existing.tags.includes(tag)) return { entry: existing, removed: false };

  const updated: AnnotationEntry = { ...existing, tags: existing.tags.filter((t) => t !== tag) };
  annotations[idx] = updated;

  // Drop entries that carry no information.
  const cleaned = annotations.filter(annotationHasContent);

  await writeFile(env, cleaned, sha, `Remove tag from ${scopeOf(shortCode, zoneCode)}: ${tag}`);
  return { entry: updated, removed: true };
}

export async function deleteAnnotation(
  env: Env,
  shortCode: string,
  zoneCode: string | null,
): Promise<boolean> {
  const { annotations, sha } = await readFile(env);
  const idx = findIndex(annotations, shortCode, zoneCode);
  if (idx === -1) return false;

  annotations.splice(idx, 1);
  await writeFile(env, annotations, sha, `Delete annotation: ${scopeOf(shortCode, zoneCode)}`);
  return true;
}

// Flags (or clears) the `removed` state on a plant+zone annotation. Removed
// combos still show in the gallery but drop out of the food web, tree, and
// zone/plant views. Returns the updated entry plus whether the flag actually
// changed (so callers can report a no-op).
export async function setAnnotationRemoved(
  env: Env,
  shortCode: string,
  zoneCode: string,
  removed: boolean,
): Promise<{ entry: AnnotationEntry; changed: boolean }> {
  const { annotations, sha } = await readFile(env);
  const idx = findIndex(annotations, shortCode, zoneCode);

  let entry: AnnotationEntry;
  if (idx === -1) {
    entry = { shortCode, zoneCode, tags: [], description: null, removed };
    annotations.push(entry);
  } else {
    entry = annotations[idx];
  }

  const changed = (entry.removed ?? false) !== removed;
  if (removed) entry.removed = true;
  else delete entry.removed;
  if (idx !== -1) annotations[idx] = entry;

  // Drop rows that no longer carry any information (e.g. restoring a combo that
  // had no tags or note left only an empty shell).
  const cleaned = annotations.filter(annotationHasContent);

  const scope = scopeOf(shortCode, zoneCode);
  await writeFile(env, cleaned, sha, removed ? `Mark removed: ${scope}` : `Restore: ${scope}`);
  return { entry, changed };
}
