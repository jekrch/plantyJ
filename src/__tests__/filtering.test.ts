import { describe, it, expect } from "bun:test";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  activeFilterCount,
  getEffectiveTags,
  applyFilters,
  computeFacets,
} from "../utils/filtering";
import type { Annotation, Filters, Zone } from "../types";
import { plant } from "./helpers";

describe("hasActiveFilters", () => {
  it("returns false for empty filters", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("returns true when tags has entries", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, tags: new Set(["native"]) })).toBe(true);
  });

  it("returns true when zoneCodes has entries", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, zoneCodes: new Set(["Z1"]) })).toBe(true);
  });

  it("returns true when postedBy has entries", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, postedBy: new Set(["alice"]) })).toBe(true);
  });

  it("returns true when misc has entries", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, misc: new Set(["plant"]) })).toBe(true);
  });
});

describe("activeFilterCount", () => {
  it("returns 0 for empty filters", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it("sums counts across all filter dimensions", () => {
    const f: Filters = {
      tags: new Set(["a", "b"]),
      zoneCodes: new Set(["Z1"]),
      postedBy: new Set<string>(),
      shortCodes: new Set<string>(),
      misc: new Set(["x"]),
    };
    expect(activeFilterCount(f)).toBe(4);
  });
});

describe("getEffectiveTags", () => {
  it("returns plant tags when no annotations", () => {
    const p = plant({ tags: ["native", "perennial"] });
    expect(getEffectiveTags(p, [])).toEqual(expect.arrayContaining(["native", "perennial"]));
    expect(getEffectiveTags(p, [])).toHaveLength(2);
  });

  it("merges plant-level annotation tags", () => {
    const p = plant({ shortCode: "rosa", tags: ["native"] });
    const ann: Annotation[] = [
      { shortCode: "rosa", zoneCode: null, tags: ["pollinator"], description: null },
    ];
    const result = getEffectiveTags(p, ann);
    expect(result).toContain("native");
    expect(result).toContain("pollinator");
  });

  it("merges zone-level annotation tags", () => {
    const p = plant({ shortCode: "rosa", zoneCode: "Z1", tags: [] });
    const ann: Annotation[] = [
      { shortCode: "rosa", zoneCode: "Z1", tags: ["shade"], description: null },
    ];
    expect(getEffectiveTags(p, ann)).toContain("shade");
  });

  it("does not include zone-level annotations for a different zone", () => {
    const p = plant({ shortCode: "rosa", zoneCode: "Z1", tags: [] });
    const ann: Annotation[] = [
      { shortCode: "rosa", zoneCode: "Z2", tags: ["sun"], description: null },
    ];
    expect(getEffectiveTags(p, ann)).not.toContain("sun");
  });

  it("deduplicates tags across sources", () => {
    const p = plant({ shortCode: "rosa", tags: ["native"] });
    const ann: Annotation[] = [
      { shortCode: "rosa", zoneCode: null, tags: ["native"], description: null },
    ];
    expect(getEffectiveTags(p, ann)).toEqual(["native"]);
  });
});

describe("applyFilters", () => {
  const plants = [
    plant({ id: "p1", shortCode: "rosa", zoneCode: "Z1", tags: ["native"], postedBy: "alice", kind: "plant" }),
    plant({ id: "p2", shortCode: "iris", zoneCode: "Z2", tags: ["perennial"], postedBy: "bob", kind: "plant" }),
    plant({ id: "p3", shortCode: "oak", zoneCode: "Z1", tags: ["tree"], postedBy: "alice", kind: "plant" }),
  ];

  it("returns all plants when filters are empty", () => {
    expect(applyFilters(plants, EMPTY_FILTERS)).toHaveLength(3);
  });

  it("filters by zoneCode", () => {
    const result = applyFilters(plants, { ...EMPTY_FILTERS, zoneCodes: new Set(["Z1"]) });
    expect(result.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("filters by shortCode", () => {
    const result = applyFilters(plants, { ...EMPTY_FILTERS, shortCodes: new Set(["iris"]) });
    expect(result.map((p) => p.id)).toEqual(["p2"]);
  });

  it("filters by postedBy", () => {
    const result = applyFilters(plants, { ...EMPTY_FILTERS, postedBy: new Set(["bob"]) });
    expect(result.map((p) => p.id)).toEqual(["p2"]);
  });

  it("filters by tag", () => {
    const result = applyFilters(plants, { ...EMPTY_FILTERS, tags: new Set(["native"]) });
    expect(result.map((p) => p.id)).toEqual(["p1"]);
  });

  it("applies multiple filter dimensions as AND logic", () => {
    const result = applyFilters(plants, {
      ...EMPTY_FILTERS,
      zoneCodes: new Set(["Z1"]),
      postedBy: new Set(["alice"]),
    });
    expect(result.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("returns empty array when no plants match", () => {
    const result = applyFilters(plants, { ...EMPTY_FILTERS, zoneCodes: new Set(["Z99"]) });
    expect(result).toHaveLength(0);
  });

  it("filters by kind=plant, excluding kind=animal", () => {
    const mixed = [
      plant({ id: "a", kind: "plant" }),
      plant({ id: "b", kind: "animal" }),
    ];
    const result = applyFilters(mixed, { ...EMPTY_FILTERS, misc: new Set(["plant"]) });
    expect(result.map((p) => p.id)).toEqual(["a"]);
  });

  it("filters by kind=animal", () => {
    const mixed = [
      plant({ id: "a", kind: "plant" }),
      plant({ id: "b", kind: "animal" }),
    ];
    const result = applyFilters(mixed, { ...EMPTY_FILTERS, misc: new Set(["animal"]) });
    expect(result.map((p) => p.id)).toEqual(["b"]);
  });

  it("filters by bioclip-match", () => {
    const withBioclip = [
      plant({ id: "m", fullName: "rosa canina", bioclipSpeciesId: "rosa canina" }),
      plant({ id: "c", fullName: "iris versicolor", bioclipSpeciesId: "other species" }),
      plant({ id: "n", fullName: null, bioclipSpeciesId: null }),
    ];
    const result = applyFilters(withBioclip, { ...EMPTY_FILTERS, misc: new Set(["bioclip-match"]) });
    expect(result.map((p) => p.id)).toEqual(["m"]);
  });

  it("filters by bioclip-conflict", () => {
    const withBioclip = [
      plant({ id: "m", fullName: "rosa canina", bioclipSpeciesId: "rosa canina" }),
      plant({ id: "c", fullName: "iris versicolor", bioclipSpeciesId: "other species" }),
    ];
    const result = applyFilters(withBioclip, { ...EMPTY_FILTERS, misc: new Set(["bioclip-conflict"]) });
    expect(result.map((p) => p.id)).toEqual(["c"]);
  });

  it("matches tag from plant-level annotation when filtering by tag", () => {
    const p = plant({ id: "ann", shortCode: "oak", zoneCode: "Z1", tags: [], postedBy: "user" });
    const anns: Annotation[] = [
      { shortCode: "oak", zoneCode: null, tags: ["annotated"], description: null },
    ];
    const result = applyFilters([p], { ...EMPTY_FILTERS, tags: new Set(["annotated"]) }, anns);
    expect(result).toHaveLength(1);
  });
});

describe("computeFacets", () => {
  const plants = [
    plant({ id: "1", shortCode: "rosa", zoneCode: "Z1", tags: ["native"], postedBy: "alice", commonName: "Wild Rose" }),
    plant({ id: "2", shortCode: "iris", zoneCode: "Z2", tags: ["perennial"], postedBy: "bob", commonName: "Blue Flag" }),
    plant({ id: "3", shortCode: "rosa", zoneCode: "Z1", tags: ["native"], postedBy: "alice", commonName: "Wild Rose" }),
  ];
  const zones: Zone[] = [
    { code: "Z1", name: "Front Yard" },
    { code: "Z2", name: "Back Yard" },
  ];

  it("counts plants per zone", () => {
    const { zoneItems } = computeFacets(plants, EMPTY_FILTERS, zones);
    const z1 = zoneItems.find((z) => z.value === "Z1");
    expect(z1?.count).toBe(2);
  });

  it("uses zone name as label", () => {
    const { zoneItems } = computeFacets(plants, EMPTY_FILTERS, zones);
    expect(zoneItems.find((z) => z.value === "Z1")?.label).toBe("Front Yard");
  });

  it("falls back to zone code when zone has no name", () => {
    const zonesNoName: Zone[] = [{ code: "Z1", name: null }];
    const { zoneItems } = computeFacets(plants.slice(0, 1), EMPTY_FILTERS, zonesNoName);
    expect(zoneItems.find((z) => z.value === "Z1")?.label).toBe("Z1");
  });

  it("counts plants per tag", () => {
    const { tagItems } = computeFacets(plants, EMPTY_FILTERS, zones);
    expect(tagItems.find((t) => t.value === "native")?.count).toBe(2);
    expect(tagItems.find((t) => t.value === "perennial")?.count).toBe(1);
  });

  it("sorts facet items alphabetically by label", () => {
    const { zoneItems } = computeFacets(plants, EMPTY_FILTERS, zones);
    const labels = zoneItems.map((z) => z.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it("excludes species filtered out by active zone when counting shortCodes", () => {
    const filtersZ1 = { ...EMPTY_FILTERS, zoneCodes: new Set(["Z1"]) };
    const { shortCodeItems } = computeFacets(plants, filtersZ1, zones);
    expect(shortCodeItems.find((s) => s.value === "iris")).toBeUndefined();
  });

  it("counts postedBy entries", () => {
    const { postedByItems } = computeFacets(plants, EMPTY_FILTERS, zones);
    expect(postedByItems.find((p) => p.value === "alice")?.count).toBe(2);
    expect(postedByItems.find((p) => p.value === "bob")?.count).toBe(1);
  });
});
