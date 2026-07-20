import type { AnnotationEntry, PicEntry, PlantRecord, Zone } from "../types";

export function joinLines(lines: (string | null | false | undefined)[]): string {
  return lines.filter(Boolean).join("\n");
}

// ─── list/format helpers ───────────────────────────────────────────────────

export function buildPlantsText(plants: PlantRecord[]): string {
  if (plants.length === 0) return "No plants yet.";
  const lines = [...plants]
    .sort((a, b) => a.shortCode.localeCompare(b.shortCode))
    .map((p) => `  ${p.shortCode} — ${p.commonName ?? p.fullName ?? p.shortCode}`);
  return `Plants:\n${lines.join("\n")}`;
}

export function buildTagsText(pics: PicEntry[], annotations: AnnotationEntry[]): string {
  const tags = new Set<string>();
  for (const p of pics) for (const t of p.tags) tags.add(t);
  for (const a of annotations) for (const t of a.tags) tags.add(t);
  if (tags.size === 0) return "No tags yet.";
  return `Tags:\n${[...tags]
    .sort()
    .map((t) => `  ${t}`)
    .join("\n")}`;
}

export function buildZonesText(zones: Zone[]): string {
  if (zones.length === 0) return "No zones yet. Add one with /addzone {code} {name}.";
  const lines = [...zones]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((z) => `  ${z.code} — ${z.name ?? "(unnamed)"}`);
  return `Zones:\n${lines.join("\n")}`;
}
