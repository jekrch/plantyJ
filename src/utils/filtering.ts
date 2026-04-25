import type { Plant, Zone } from "../types";

export interface Filters {
  tags: Set<string>;
  zoneCodes: Set<string>;
  postedBy: Set<string>;
  shortCodes: Set<string>;
}

export const EMPTY_FILTERS: Filters = {
  tags: new Set(),
  zoneCodes: new Set(),
  postedBy: new Set(),
  shortCodes: new Set(),
};

export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.tags.size > 0 ||
    filters.zoneCodes.size > 0 ||
    filters.postedBy.size > 0 ||
    filters.shortCodes.size > 0
  );
}

export function activeFilterCount(filters: Filters): number {
  return (
    filters.tags.size +
    filters.zoneCodes.size +
    filters.postedBy.size +
    filters.shortCodes.size
  );
}

function plantMatchesZones(plant: Plant, zoneFilter: Set<string>): boolean {
  if (zoneFilter.size === 0) return true;
  return plant.zoneCodes.some((z) => zoneFilter.has(z));
}

export function applyFilters(plants: Plant[], filters: Filters): Plant[] {
  if (!hasActiveFilters(filters)) return plants;
  return plants.filter((p) => {
    if (!plantMatchesZones(p, filters.zoneCodes)) return false;
    if (filters.shortCodes.size > 0 && !filters.shortCodes.has(p.shortCode)) return false;
    if (filters.postedBy.size > 0 && !filters.postedBy.has(p.postedBy)) return false;
    if (filters.tags.size > 0) {
      const tags = p.tags ?? [];
      if (!tags.some((t) => filters.tags.has(t))) return false;
    }
    return true;
  });
}

export interface FacetItem {
  /** The canonical key (zoneCode, shortCode, etc). */
  value: string;
  /** Display label for the UI (zoneName, commonName, etc). */
  label: string;
  count: number;
}

function pickShortCodeLabel(plants: Plant[], value: string): string {
  for (const p of plants) {
    if (p.shortCode === value) return p.commonName ?? p.fullName ?? value;
  }
  return value;
}

function pickZoneLabel(zones: Zone[], code: string): string {
  return zones.find((z) => z.code === code)?.name ?? code;
}

export function computeFacets(plants: Plant[], filters: Filters, zones: Zone[]) {
  const tagCounts = new Map<string, number>();
  const zoneCounts = new Map<string, number>();
  const postedByCounts = new Map<string, number>();
  const shortCodeCounts = new Map<string, number>();

  for (const p of plants) {
    const passZone = plantMatchesZones(p, filters.zoneCodes);
    const passShort = filters.shortCodes.size === 0 || filters.shortCodes.has(p.shortCode);
    const passPostedBy = filters.postedBy.size === 0 || filters.postedBy.has(p.postedBy);
    const passTags =
      filters.tags.size === 0 || (p.tags ?? []).some((t) => filters.tags.has(t));

    if (passShort && passPostedBy && passTags) {
      for (const code of p.zoneCodes) {
        zoneCounts.set(code, (zoneCounts.get(code) ?? 0) + 1);
      }
    }
    if (passZone && passPostedBy && passTags) {
      shortCodeCounts.set(p.shortCode, (shortCodeCounts.get(p.shortCode) ?? 0) + 1);
    }
    if (passZone && passShort && passTags) {
      postedByCounts.set(p.postedBy, (postedByCounts.get(p.postedBy) ?? 0) + 1);
    }
    if (passZone && passShort && passPostedBy) {
      for (const t of p.tags ?? []) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
  }

  const toItems = (
    counts: Map<string, number>,
    labelFor?: (value: string) => string
  ): FacetItem[] =>
    Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: labelFor ? labelFor(value) : value,
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

  return {
    tagItems: toItems(tagCounts),
    zoneItems: toItems(zoneCounts, (v) => pickZoneLabel(zones, v)),
    postedByItems: toItems(postedByCounts),
    shortCodeItems: toItems(shortCodeCounts, (v) => pickShortCodeLabel(plants, v)),
  };
}
