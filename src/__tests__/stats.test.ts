import { describe, it, expect } from "bun:test";
import {
  computeStats,
  buildTimeline,
  startOfBucket,
  advanceBucket,
  bucketSizeMs,
  formatBucket,
} from "../utils/stats";
import type { AIAnalysis, Species, SpeciesTaxonomy, Zone } from "../types";
import { organism } from "./helpers";

function species(taxonomy: Partial<SpeciesTaxonomy> | null): Species {
  return {
    id: "s",
    fullName: "Sp",
    commonName: null,
    description: null,
    vernacularNames: [],
    taxonomy: taxonomy
      ? {
          kingdom: null,
          phylum: null,
          class: null,
          order: null,
          family: null,
          genus: null,
          species: null,
          canonicalName: null,
          ...taxonomy,
        }
      : null,
    nativeRange: null,
    references: [],
    sources: [],
  };
}

const NO_ZONES: Zone[] = [];
const NO_AI: AIAnalysis[] = [];
const emptySpecies = new Map<string, Species>();

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString();

describe("computeStats — basics", () => {
  it("reports zero-ish stats for empty input", () => {
    const s = computeStats([], NO_ZONES, emptySpecies, NO_AI);
    expect(s.totalPics).toBe(0);
    expect(s.daysSinceFirst).toBe(0);
    expect(s.firstDate).toBeNull();
    expect(s.timeline.buckets).toEqual([]);
    expect(s.topZoneByPics).toBeNull();
  });

  it("counts total pics and the zone/total split", () => {
    const s = computeStats(
      [
        organism({ zoneCode: "Z1" }),
        organism({ zoneCode: "Z1" }),
        organism({ zoneCode: "Z2" }),
      ],
      [
        { code: "Z1", name: "Front" },
        { code: "Z2", name: "Back" },
        { code: "Z3", name: "Unused" },
      ],
      emptySpecies,
      NO_AI,
    );
    expect(s.totalPics).toBe(3);
    expect(s.zonesWithPics).toBe(2);
    expect(s.totalZones).toBe(3);
  });

  it("derives daysSinceFirst/firstDate only from the seq=1 pic", () => {
    const withSeqOne = computeStats(
      [organism({ seq: 1, addedAt: daysAgo(9) }), organism({ seq: 2 })],
      NO_ZONES,
      emptySpecies,
      NO_AI,
    );
    expect(withSeqOne.daysSinceFirst).toBeGreaterThanOrEqual(1);
    expect(typeof withSeqOne.firstDate).toBe("string");

    const noSeqOne = computeStats(
      [organism({ seq: 5 })],
      NO_ZONES,
      emptySpecies,
      NO_AI,
    );
    expect(noSeqOne.daysSinceFirst).toBe(0);
    expect(noSeqOne.firstDate).toBeNull();
  });
});

describe("computeStats — plants vs animals", () => {
  it("splits by kind, defaulting missing kind to plant, and counts unique species", () => {
    const s = computeStats(
      [
        organism({ shortCode: "rose" }), // kind missing -> plant
        organism({ shortCode: "rose", kind: "plant" }),
        organism({ shortCode: "oak", kind: "plant" }),
        organism({ shortCode: "fox", kind: "animal" }),
        organism({ shortCode: "fox", kind: "animal" }),
      ],
      NO_ZONES,
      emptySpecies,
      NO_AI,
    );
    expect(s.organismPicCount).toBe(3);
    expect(s.animalPicCount).toBe(2);
    expect(s.uniqueOrganismSpecies).toBe(2); // rose, oak
    expect(s.uniqueAnimalSpecies).toBe(1); // fox
  });
});

describe("computeStats — zones", () => {
  it("picks the most photographed and most diverse zones", () => {
    const s = computeStats(
      [
        // Z1: 3 pics, 1 species
        organism({ zoneCode: "Z1", shortCode: "a" }),
        organism({ zoneCode: "Z1", shortCode: "a" }),
        organism({ zoneCode: "Z1", shortCode: "a" }),
        // Z2: 2 pics, 2 species
        organism({ zoneCode: "Z2", shortCode: "b" }),
        organism({ zoneCode: "Z2", shortCode: "c" }),
      ],
      [
        { code: "Z1", name: "Bed One" },
        { code: "Z2", name: "Bed Two" },
      ],
      emptySpecies,
      NO_AI,
    );
    expect(s.topZoneByPics).toEqual({ code: "Z1", name: "Bed One", count: 3 });
    expect(s.topZoneByDiversity).toEqual({ code: "Z2", name: "Bed Two", count: 2 });
  });

  it("falls back to the zone code when no name is given", () => {
    const s = computeStats(
      [organism({ zoneCode: "Z9" })],
      [{ code: "Z9", name: null }],
      emptySpecies,
      NO_AI,
    );
    expect(s.topZoneByPics).toEqual({ code: "Z9", name: "Z9", count: 1 });
  });
});

describe("computeStats — taxa rollup", () => {
  it("counts distinct values per rank and tallies pics", () => {
    const sp = new Map<string, Species>([
      ["a", species({ family: "Rosaceae", genus: "Rosa" })],
      ["b", species({ family: "Rosaceae", genus: "Rubus" })],
      ["c", species({ family: "Fagaceae", genus: "Quercus" })],
    ]);
    const s = computeStats(
      [
        organism({ shortCode: "a" }),
        organism({ shortCode: "a" }),
        organism({ shortCode: "b" }),
        organism({ shortCode: "c" }),
        organism({ shortCode: "unknown" }), // no species -> skipped
      ],
      NO_ZONES,
      sp,
      NO_AI,
    );
    expect(s.taxa.countsByRank.family).toBe(2);
    expect(s.taxa.countsByRank.genus).toBe(3);
    const fam = Object.fromEntries(
      s.taxa.slicesByRank.family.map((x) => [x.name, x.value]),
    );
    expect(fam).toEqual({ Rosaceae: 3, Fagaceae: 1 });
  });

  it("rolls everything beyond the top 8 into an 'Other (n)' slice", () => {
    const sp = new Map<string, Species>();
    const organisms = [];
    for (let i = 0; i < 11; i++) {
      const code = `g${i}`;
      sp.set(code, species({ genus: `Genus${i}` }));
      // Give earlier genera more pics so ordering is deterministic.
      for (let k = 0; k <= 11 - i; k++) organisms.push(organism({ shortCode: code }));
    }
    const s = computeStats(organisms, NO_ZONES, sp, NO_AI);
    const slices = s.taxa.slicesByRank.genus;
    expect(s.taxa.countsByRank.genus).toBe(11);
    expect(slices).toHaveLength(9); // 8 top + 1 Other
    const other = slices[8];
    expect(other.name).toBe("Other (3)");
    // Pic count per genus is (12 - i); after sorting desc the 3 smallest
    // (Genus8/9/10 -> 4/3/2 pics) fall outside the top 8 and roll up.
    expect(other.value).toBe(4 + 3 + 2);
  });
});

describe("computeStats — bioclip", () => {
  it("averages confidence over scored pics only", () => {
    const s = computeStats(
      [
        organism({ bioclipScore: 0.8 }),
        organism({ bioclipScore: 0.4 }),
        organism({ bioclipScore: null }),
        organism({}),
      ],
      NO_ZONES,
      emptySpecies,
      NO_AI,
    );
    expect(s.bioclip.avgConfidence).toBeCloseTo(0.6, 10);
  });

  it("is null when nothing is scored", () => {
    const s = computeStats([organism({})], NO_ZONES, emptySpecies, NO_AI);
    expect(s.bioclip.avgConfidence).toBeNull();
  });

  it("gives genus-only matches half credit on both sides", () => {
    const s = computeStats(
      [
        // exact match
        organism({ bioclipSpeciesId: "Rosa rubiginosa", fullName: "Rosa rubiginosa" }),
        // genus-only match
        organism({ bioclipSpeciesId: "Rosa canina", fullName: "Rosa rubiginosa" }),
        // full mismatch
        organism({ bioclipSpeciesId: "Quercus alba", fullName: "Rosa rubiginosa" }),
        // missing data -> ignored
        organism({ bioclipSpeciesId: null, fullName: "Rosa rubiginosa" }),
      ],
      NO_ZONES,
      emptySpecies,
      NO_AI,
    );
    expect(s.bioclip.genusOnly).toBe(1);
    expect(s.bioclip.agreements).toBe(1 + 0.5);
    expect(s.bioclip.disagreements).toBe(1 + 0.5);
  });

  it("counts pics without a fullName as unidentified", () => {
    const s = computeStats(
      [organism({ fullName: "Rosa" }), organism({ fullName: null }), organism({ fullName: null })],
      NO_ZONES,
      emptySpecies,
      NO_AI,
    );
    expect(s.unidentifiedPics).toBe(2);
  });
});

describe("computeStats — eco fit", () => {
  it("maps each pic to its (shortCode, zoneCode) verdict and tallies the rest as unrated", () => {
    const ai: AIAnalysis[] = [
      { shortCode: "rose", zoneCode: "Z1", verdict: "GOOD", analysis: "", references: [], created: "" },
      { shortCode: "oak", zoneCode: "Z2", verdict: "BAD", analysis: "", references: [], created: "" },
    ];
    const s = computeStats(
      [
        organism({ shortCode: "rose", zoneCode: "Z1" }), // GOOD
        organism({ shortCode: "rose", zoneCode: "Z1" }), // GOOD
        organism({ shortCode: "oak", zoneCode: "Z2" }), // BAD
        organism({ shortCode: "rose", zoneCode: "Z2" }), // no verdict
      ],
      NO_ZONES,
      emptySpecies,
      ai,
    );
    expect(s.ecoFit.counts).toEqual({ GOOD: 2, MIXED: 0, BAD: 1 });
    expect(s.ecoFit.rated).toBe(3);
    expect(s.ecoFit.unrated).toBe(1);
  });
});

describe("date bucket helpers", () => {
  it("startOfBucket truncates to the start of day/week/month", () => {
    const d = new Date("2024-03-13T15:30:00"); // a Wednesday
    expect(startOfBucket(d, "day").toISOString()).toBe(
      new Date(2024, 2, 13, 0, 0, 0, 0).toISOString(),
    );
    // Week is Sunday-start: 2024-03-13 (Wed) -> 2024-03-10 (Sun)
    expect(startOfBucket(d, "week").toISOString()).toBe(
      new Date(2024, 2, 10, 0, 0, 0, 0).toISOString(),
    );
    expect(startOfBucket(d, "month").toISOString()).toBe(
      new Date(2024, 2, 1, 0, 0, 0, 0).toISOString(),
    );
  });

  it("advanceBucket steps forward by one unit", () => {
    const d = new Date(2024, 0, 31, 0, 0, 0, 0);
    expect(advanceBucket(d, "day").getDate()).toBe(1); // Feb 1
    expect(advanceBucket(new Date(2024, 0, 1), "week").getDate()).toBe(8);
    expect(advanceBucket(new Date(2024, 0, 15), "month").getMonth()).toBe(1);
  });

  it("bucketSizeMs returns the unit length in ms", () => {
    expect(bucketSizeMs("day")).toBe(86400000);
    expect(bucketSizeMs("week")).toBe(7 * 86400000);
    expect(bucketSizeMs("month")).toBe(31 * 86400000);
  });

  it("formatBucket uses a month/year label only for month granularity", () => {
    const d = new Date(2024, 2, 5);
    expect(formatBucket(d, "month")).not.toContain("5");
    expect(formatBucket(d, "day")).toContain("5");
  });
});

describe("buildTimeline", () => {
  it("returns an empty timeline when there is no earliest date", () => {
    expect(buildTimeline([organism({})], null)).toEqual({
      buckets: [],
      caption: "Photos over time",
    });
  });

  it("chooses granularity from the span and assigns every in-range pic to a bucket", () => {
    const cases: { span: number; caption: string }[] = [
      { span: 10, caption: "Photos per day" },
      { span: 100, caption: "Photos per week" },
      { span: 500, caption: "Photos per month" },
    ];
    for (const { span, caption } of cases) {
      const earliest = new Date(Date.now() - span * 86400000);
      const pics = [
        organism({ addedAt: earliest.toISOString() }),
        organism({ addedAt: new Date(Date.now() - (span / 2) * 86400000).toISOString() }),
        organism({ addedAt: new Date().toISOString() }),
      ];
      const { buckets, caption: cap } = buildTimeline(pics, earliest);
      expect(cap).toBe(caption);
      expect(buckets.length).toBeGreaterThan(0);
      const total = buckets.reduce((acc, b) => acc + b.count, 0);
      expect(total).toBe(3);
    }
  });

  it("ignores pics with an unparseable date", () => {
    const earliest = new Date(Date.now() - 5 * 86400000);
    const { buckets } = buildTimeline(
      [organism({ addedAt: earliest.toISOString() }), organism({ addedAt: "not-a-date" })],
      earliest,
    );
    expect(buckets.reduce((acc, b) => acc + b.count, 0)).toBe(1);
  });
});
