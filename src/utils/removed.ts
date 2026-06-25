import type { Annotation, Organism } from "../types";

// A plant+zone combo flagged `removed` still appears in the gallery/roll, but
// is filtered out of the food web, tree, and zone/plant views. Removal is
// always scoped to a specific (shortCode, zoneCode) pairing.

// A pipe can't appear in a validated shortCode or zoneCode, so this key is
// collision-free without escaping. Exported so every consumer (gallery card,
// filtering) builds the key the same way.
export function removedComboKey(shortCode: string, zoneCode: string): string {
  return `${shortCode}|${zoneCode}`;
}

/** Set of combo keys (see removedComboKey) that have been marked removed. */
export function buildRemovedSet(annotations: Annotation[]): Set<string> {
  const set = new Set<string>();
  for (const a of annotations) {
    if (a.removed && a.zoneCode) set.add(removedComboKey(a.shortCode, a.zoneCode));
  }
  return set;
}

/** Whether this pic's plant+zone combo is flagged removed. */
export function isOrganismRemoved(organism: Organism, removedSet: Set<string>): boolean {
  return removedSet.has(removedComboKey(organism.shortCode, organism.zoneCode));
}

/** Organisms whose plant+zone combo has NOT been removed. */
export function activeOrganisms(organisms: Organism[], removedSet: Set<string>): Organism[] {
  if (removedSet.size === 0) return organisms;
  return organisms.filter((o) => !isOrganismRemoved(o, removedSet));
}

/**
 * shortCodes that are entirely removed from the garden — every pic of the plant
 * belongs to a removed combo. The food web is plant-centric (keyed by
 * shortCode), so a node should only disappear when the plant has no remaining
 * active presence in any zone.
 */
export function fullyRemovedShortCodes(
  organisms: Organism[],
  removedSet: Set<string>,
): Set<string> {
  if (removedSet.size === 0) return new Set();
  const hasActive = new Set<string>();
  const seen = new Set<string>();
  for (const o of organisms) {
    seen.add(o.shortCode);
    if (!isOrganismRemoved(o, removedSet)) hasActive.add(o.shortCode);
  }
  const fully = new Set<string>();
  for (const code of seen) if (!hasActive.has(code)) fully.add(code);
  return fully;
}
