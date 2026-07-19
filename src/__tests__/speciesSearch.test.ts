import { describe, it, expect } from "bun:test";
import {
  searchDataset,
  parseInaturalist,
  mergeMatches,
  suggestShortCode,
  type SpeciesMatch,
} from "../data/speciesSearch";
import type { Species } from "../types";

function species(partial: Partial<Species>): Species {
  return {
    id: partial.fullName?.toLowerCase().replace(/\s+/g, "-") ?? "x",
    fullName: null,
    commonName: null,
    description: null,
    vernacularNames: [],
    taxonomy: null,
    nativeRange: null,
    references: [],
    sources: [],
    ...partial,
  };
}

const dataset: Species[] = [
  species({ fullName: "Solanum lycopersicum", commonName: "Tomato" }),
  species({
    fullName: "Echinacea purpurea",
    commonName: "Purple Coneflower",
    vernacularNames: ["Eastern Purple Coneflower"],
    taxonomy: { kingdom: "Plantae" } as Species["taxonomy"],
  }),
  species({ fullName: "Acer platanoides", commonName: "Norway Maple" }),
];

describe("searchDataset", () => {
  it("matches on common name", () => {
    const r = searchDataset(dataset, "tomato");
    expect(r.map((m) => m.scientificName)).toEqual(["Solanum lycopersicum"]);
    expect(r[0].source).toBe("dataset");
  });

  it("matches on scientific name and vernacular names", () => {
    expect(searchDataset(dataset, "echinacea")[0].commonName).toBe("Purple Coneflower");
    expect(searchDataset(dataset, "eastern purple")[0].scientificName).toBe("Echinacea purpurea");
  });

  it("ranks prefix matches ahead of interior matches", () => {
    const r = searchDataset(dataset, "purple");
    // "Purple Coneflower" (prefix) beats a plant that only contains "purple".
    expect(r[0].commonName).toBe("Purple Coneflower");
  });

  it("carries the kingdom as the group badge", () => {
    expect(searchDataset(dataset, "echinacea")[0].group).toBe("Plantae");
  });

  it("returns nothing for blank or unmatched queries", () => {
    expect(searchDataset(dataset, "  ")).toEqual([]);
    expect(searchDataset(dataset, "zzzzz")).toEqual([]);
  });
});

describe("parseInaturalist", () => {
  it("maps taxa and capitalizes common names", () => {
    const r = parseInaturalist([
      {
        name: "Ocimum basilicum",
        preferred_common_name: "sweet basil",
        rank: "species",
        iconic_taxon_name: "Plantae",
      },
    ]);
    expect(r[0]).toEqual({
      scientificName: "Ocimum basilicum",
      commonName: "Sweet basil",
      rank: "species",
      group: "Plantae",
      source: "inaturalist",
    });
  });

  it("drops entries without a name and overly-broad ranks", () => {
    const r = parseInaturalist([
      { name: "Plantae", rank: "kingdom" },
      { rank: "species" },
      { name: "Ocimum", rank: "genus" },
    ]);
    expect(r.map((m) => m.scientificName)).toEqual(["Ocimum"]);
  });

  it("leaves a missing common name null", () => {
    expect(parseInaturalist([{ name: "Acer sp", rank: "species" }])[0].commonName).toBeNull();
  });
});

describe("mergeMatches", () => {
  const d: SpeciesMatch[] = [
    { scientificName: "Solanum lycopersicum", commonName: "Tomato", rank: "species", group: null, source: "dataset" },
  ];
  const e: SpeciesMatch[] = [
    { scientificName: "solanum lycopersicum", commonName: "tomato", rank: "species", group: "Plantae", source: "inaturalist" },
    { scientificName: "Ocimum basilicum", commonName: "Sweet basil", rank: "species", group: "Plantae", source: "inaturalist" },
  ];

  it("dedupes case-insensitively, keeping the dataset entry", () => {
    const r = mergeMatches(d, e);
    expect(r).toHaveLength(2);
    expect(r[0].source).toBe("dataset");
    expect(r.map((m) => m.scientificName)).toContain("Ocimum basilicum");
  });

  it("honors the limit", () => {
    expect(mergeMatches(d, e, 1)).toHaveLength(1);
  });
});

describe("suggestShortCode", () => {
  it("builds genus-initial + species-prefix codes", () => {
    expect(suggestShortCode("Asclepias syriaca", "Common Milkweed", new Set())).toBe("A syr");
    expect(suggestShortCode("Bouteloua curtipendula", null, new Set())).toBe("B cur");
  });

  it("falls back to the common name when no binomial is available", () => {
    expect(suggestShortCode(null, "Cherokee Purple Tomato", new Set())).toBe("che-pur");
  });

  it("disambiguates against taken codes", () => {
    expect(suggestShortCode("Asclepias syriaca", null, new Set(["A syr"]))).toBe("A syr2");
  });

  it("returns empty when there is nothing to build from", () => {
    expect(suggestShortCode(null, null, new Set())).toBe("");
  });
});
