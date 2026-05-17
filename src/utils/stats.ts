import type {
  AIAnalysis,
  AIVerdict,
  Organism,
  Species,
  SpeciesTaxonomy,
  Zone,
} from "../types";

export type TaxonRank =
  | "kingdom"
  | "phylum"
  | "class"
  | "order"
  | "family"
  | "genus";

export const RANKS: { id: TaxonRank; label: string; plural: string }[] = [
  { id: "kingdom", label: "Kingdom", plural: "Kingdoms" },
  { id: "phylum", label: "Phylum", plural: "Phyla" },
  { id: "class", label: "Class", plural: "Classes" },
  { id: "order", label: "Order", plural: "Orders" },
  { id: "family", label: "Family", plural: "Families" },
  { id: "genus", label: "Genus", plural: "Genera" },
];

export interface Slice {
  name: string;
  value: number;
}

export interface TimelineBucket {
  label: string;
  date: Date;
  count: number;
}

export interface ComputedStats {
  totalPics: number;
  daysSinceFirst: number;
  firstDate: string | null;
  uniqueOrganismSpecies: number;
  uniqueAnimalSpecies: number;
  organismPicCount: number;
  animalPicCount: number;
  zonesWithPics: number;
  totalZones: number;
  taxa: {
    countsByRank: Record<TaxonRank, number>;
    slicesByRank: Record<TaxonRank, Slice[]>;
  };
  timeline: { buckets: TimelineBucket[]; caption: string };
  topZoneByPics: { code: string; name: string; count: number } | null;
  topZoneByDiversity: { code: string; name: string; count: number } | null;
  bioclip: {
    avgConfidence: number | null;
    agreements: number;
    disagreements: number;
    genusOnly: number;
  };
  unidentifiedPics: number;
  ecoFit: {
    counts: Record<AIVerdict, number>;
    rated: number;
    unrated: number;
  };
}

export function computeStats(
  organisms: Organism[],
  zones: Zone[],
  speciesByShortCode: Map<string, Species>,
  aiAnalyses: AIAnalysis[],
): ComputedStats {
  const totalPics = organisms.length;

  // Days since seq=1 pic
  const seqOne = organisms.find((p) => p.seq === 1);
  const earliest = seqOne ? new Date(seqOne.addedAt) : null;
  let daysSinceFirst = 0;
  let firstDate: string | null = null;
  if (earliest && !Number.isNaN(earliest.getTime())) {
    const now = new Date();
    daysSinceFirst = Math.max(1, Math.floor((now.getTime() - earliest.getTime()) / 86400000) + 1);
    firstDate = earliest.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // Plants vs animals — split by `kind`, default to organism when missing
  const organismPics = organisms.filter((p) => (p.kind ?? "plant") === "plant");
  const animalPics = organisms.filter((p) => p.kind === "animal");
  const uniqueOrganismSpecies = new Set(organismPics.map((p) => p.shortCode)).size;
  const uniqueAnimalSpecies = new Set(animalPics.map((p) => p.shortCode)).size;

  // Zones
  const picsByZone = new Map<string, Organism[]>();
  for (const p of organisms) {
    const list = picsByZone.get(p.zoneCode) ?? [];
    list.push(p);
    picsByZone.set(p.zoneCode, list);
  }
  const zoneNameByCode = new Map(zones.map((z) => [z.code, z.name ?? z.code]));
  const zoneCounts = Array.from(picsByZone.entries()).map(([code, list]) => ({
    code,
    name: zoneNameByCode.get(code) ?? code,
    count: list.length,
    diversity: new Set(list.map((p) => p.shortCode)).size,
  }));
  zoneCounts.sort((a, b) => b.count - a.count);
  const topZoneByPics = zoneCounts[0]
    ? { code: zoneCounts[0].code, name: zoneCounts[0].name, count: zoneCounts[0].count }
    : null;
  const sortedByDiversity = [...zoneCounts].sort((a, b) => b.diversity - a.diversity);
  const topZoneByDiversity = sortedByDiversity[0]
    ? { code: sortedByDiversity[0].code, name: sortedByDiversity[0].name, count: sortedByDiversity[0].diversity }
    : null;

  // Higher taxa — pull from speciesByShortCode lookups, accumulating
  // counts at every rank so the user can pivot the pie chart on any of them.
  const rankIds: TaxonRank[] = ["kingdom", "phylum", "class", "order", "family", "genus"];
  const picCountsByRank: Record<TaxonRank, Map<string, number>> = {
    kingdom: new Map(),
    phylum: new Map(),
    class: new Map(),
    order: new Map(),
    family: new Map(),
    genus: new Map(),
  };
  for (const p of organisms) {
    const sp = speciesByShortCode.get(p.shortCode);
    const tx = sp?.taxonomy;
    if (!tx) continue;
    for (const r of rankIds) {
      const v = (tx as SpeciesTaxonomy)[r];
      if (!v) continue;
      const m = picCountsByRank[r];
      m.set(v, (m.get(v) ?? 0) + 1);
    }
  }
  const TOP_N = 8;
  const slicesByRank = {} as Record<TaxonRank, Slice[]>;
  const countsByRank = {} as Record<TaxonRank, number>;
  for (const r of rankIds) {
    const all = Array.from(picCountsByRank[r].entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    countsByRank[r] = all.length;
    if (all.length > TOP_N) {
      const top = all.slice(0, TOP_N);
      const rest = all.slice(TOP_N);
      const otherTotal = rest.reduce((acc, s) => acc + s.value, 0);
      slicesByRank[r] = [...top, { name: `Other (${rest.length})`, value: otherTotal }];
    } else {
      slicesByRank[r] = all;
    }
  }

  // Timeline auto-bucketing
  const timeline = buildTimeline(organisms, earliest);

  // BioCLIP
  const scored = organisms.filter(
    (p) => typeof p.bioclipScore === "number" && !Number.isNaN(p.bioclipScore),
  );
  const avgConfidence = scored.length > 0
    ? scored.reduce((acc, p) => acc + (p.bioclipScore ?? 0), 0) / scored.length
    : null;
  // Genus-only matches count as half-credit — the model got the lineage
  // right even if the species ended up wrong, so they add 0.5 to both
  // agreements and disagreements.
  let fullMatches = 0;
  let genusOnly = 0;
  let mismatches = 0;
  for (const p of organisms) {
    if (!p.bioclipSpeciesId || !p.fullName) continue;
    const a = p.bioclipSpeciesId.trim().toLowerCase();
    const b = p.fullName.trim().toLowerCase();
    if (a === b) {
      fullMatches += 1;
      continue;
    }
    const genusA = a.split(/\s+/)[0];
    const genusB = b.split(/\s+/)[0];
    if (genusA && genusA === genusB) genusOnly += 1;
    else mismatches += 1;
  }
  const agreements = fullMatches + 0.5 * genusOnly;
  const disagreements = mismatches + 0.5 * genusOnly;

  // Unidentified — pics without a species fullName attached
  const unidentifiedPics = organisms.filter((p) => !p.fullName).length;

  // Eco fit (AI) — verdict is keyed by (shortCode, zoneCode), so each organism
  // pic inherits the verdict of its (species, zone) pairing.
  const verdictMap = new Map<string, AIVerdict>();
  for (const a of aiAnalyses) {
    verdictMap.set(`${a.shortCode} ${a.zoneCode}`, a.verdict);
  }
  const ecoFitCounts: Record<AIVerdict, number> = { GOOD: 0, MIXED: 0, BAD: 0 };
  let ecoFitUnrated = 0;
  for (const p of organisms) {
    const v = verdictMap.get(`${p.shortCode} ${p.zoneCode}`);
    if (v) ecoFitCounts[v] += 1;
    else ecoFitUnrated += 1;
  }
  const ecoFitRated = ecoFitCounts.GOOD + ecoFitCounts.MIXED + ecoFitCounts.BAD;

  return {
    totalPics,
    daysSinceFirst,
    firstDate,
    uniqueOrganismSpecies,
    uniqueAnimalSpecies,
    organismPicCount: organismPics.length,
    animalPicCount: animalPics.length,
    zonesWithPics: picsByZone.size,
    totalZones: zones.length,
    taxa: { countsByRank, slicesByRank },
    timeline,
    topZoneByPics,
    topZoneByDiversity,
    bioclip: { avgConfidence, agreements, disagreements, genusOnly },
    unidentifiedPics,
    ecoFit: {
      counts: ecoFitCounts,
      rated: ecoFitRated,
      unrated: ecoFitUnrated,
    },
  };
}

export function buildTimeline(
  organisms: Organism[],
  earliest: Date | null,
): { buckets: TimelineBucket[]; caption: string } {
  if (!earliest || organisms.length === 0) return { buckets: [], caption: "Photos over time" };
  const now = new Date();
  const spanDays = (now.getTime() - earliest.getTime()) / 86400000;

  type Granularity = "day" | "week" | "month";
  // Adapt granularity to the span so the chart stays readable as the
  // collection grows. Recompute every time so the timeline self-scopes.
  let granularity: Granularity;
  let bucketCount: number;
  if (spanDays <= 60) {
    granularity = "day";
    bucketCount = Math.max(7, Math.ceil(spanDays) + 1);
  } else if (spanDays <= 365) {
    granularity = "week";
    bucketCount = Math.ceil(spanDays / 7) + 1;
  } else {
    granularity = "month";
    bucketCount = Math.ceil(spanDays / 30) + 1;
  }

  const buckets: TimelineBucket[] = [];
  const start = startOfBucket(earliest, granularity);
  let cursor = new Date(start);
  for (let i = 0; i < bucketCount; i++) {
    buckets.push({
      label: formatBucket(cursor, granularity),
      date: new Date(cursor),
      count: 0,
    });
    cursor = advanceBucket(cursor, granularity);
    if (cursor.getTime() > now.getTime() + bucketSizeMs(granularity)) break;
  }

  for (const p of organisms) {
    const d = new Date(p.addedAt);
    if (Number.isNaN(d.getTime())) continue;
    const b = startOfBucket(d, granularity).getTime();
    const idx = buckets.findIndex((bucket) => bucket.date.getTime() === b);
    if (idx >= 0) buckets[idx].count += 1;
  }

  const caption = granularity === "day"
    ? "Photos per day"
    : granularity === "week"
      ? "Photos per week"
      : "Photos per month";
  return { buckets, caption };
}

export function startOfBucket(d: Date, g: "day" | "week" | "month"): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  if (g === "day") return r;
  if (g === "week") {
    r.setDate(r.getDate() - r.getDay()); // Sunday-start week
    return r;
  }
  r.setDate(1);
  return r;
}

export function advanceBucket(d: Date, g: "day" | "week" | "month"): Date {
  const r = new Date(d);
  if (g === "day") r.setDate(r.getDate() + 1);
  else if (g === "week") r.setDate(r.getDate() + 7);
  else r.setMonth(r.getMonth() + 1);
  return r;
}

export function bucketSizeMs(g: "day" | "week" | "month"): number {
  if (g === "day") return 86400000;
  if (g === "week") return 7 * 86400000;
  return 31 * 86400000;
}

export function formatBucket(d: Date, g: "day" | "week" | "month"): string {
  if (g === "month") {
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
