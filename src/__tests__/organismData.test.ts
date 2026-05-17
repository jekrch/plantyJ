import { describe, it, expect } from "bun:test";
import {
  slugifyName,
  mergeOrganisms,
  buildSpeciesMap,
} from "../hooks/useOrganismData";
import type { OrganismRecord, PicRecord, Species } from "../types";

function pic(overrides: Partial<PicRecord> = {}): PicRecord {
  return {
    seq: 1,
    id: "pic-1",
    shortCode: "rose",
    zoneCode: "Z1",
    tags: [],
    description: null,
    image: "img.jpg",
    postedBy: "user",
    addedAt: "2024-01-01T00:00:00Z",
    width: 100,
    height: 100,
    ...overrides,
  };
}

function record(overrides: Partial<OrganismRecord> = {}): OrganismRecord {
  return {
    shortCode: "rose",
    fullName: "Rosa rubiginosa",
    commonName: "Sweet briar",
    variety: null,
    ...overrides,
  };
}

function species(overrides: Partial<Species> = {}): Species {
  return {
    id: "s1",
    fullName: "Rosa rubiginosa",
    commonName: "Sweet briar",
    description: null,
    vernacularNames: [],
    taxonomy: null,
    nativeRange: null,
    references: [],
    sources: [],
    ...overrides,
  };
}

describe("slugifyName", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugifyName("Rosa rubiginosa")).toBe("rosa-rubiginosa");
  });

  it("collapses runs of non-alphanumerics into a single hyphen", () => {
    expect(slugifyName("Echeveria 'Black Prince'")).toBe(
      "echeveria-black-prince"
    );
  });

  it("trims leading and trailing separators", () => {
    expect(slugifyName("  Aloe vera!  ")).toBe("aloe-vera");
  });

  it("strips diacritics-adjacent punctuation but keeps digits", () => {
    expect(slugifyName("Agave No. 2")).toBe("agave-no-2");
  });
});

describe("mergeOrganisms", () => {
  it("fills name fields from the matching plant record", () => {
    const [merged] = mergeOrganisms(
      [pic({ shortCode: "rose" })],
      [record({ shortCode: "rose", fullName: "Rosa", commonName: "Rose", variety: "wild" })]
    );
    expect(merged.fullName).toBe("Rosa");
    expect(merged.commonName).toBe("Rose");
    expect(merged.variety).toBe("wild");
  });

  it("leaves name fields null when no plant record matches", () => {
    const [merged] = mergeOrganisms([pic({ shortCode: "ghost" })], [record()]);
    expect(merged.fullName).toBeNull();
    expect(merged.commonName).toBeNull();
    expect(merged.variety).toBeNull();
  });

  it("preserves the original pic fields", () => {
    const p = pic({ id: "pic-42", image: "x.webp", tags: ["a", "b"] });
    const [merged] = mergeOrganisms([p], []);
    expect(merged.id).toBe("pic-42");
    expect(merged.image).toBe("x.webp");
    expect(merged.tags).toEqual(["a", "b"]);
  });

  it("returns an empty array for empty input", () => {
    expect(mergeOrganisms([], [])).toEqual([]);
  });

  it("matches each pic to its own record by shortCode", () => {
    const merged = mergeOrganisms(
      [
        pic({ id: "p1", shortCode: "a" }),
        pic({ id: "p2", shortCode: "b" }),
      ],
      [
        record({ shortCode: "a", commonName: "Alpha" }),
        record({ shortCode: "b", commonName: "Beta" }),
      ]
    );
    expect(merged.map((m) => m.commonName)).toEqual(["Alpha", "Beta"]);
  });
});

describe("buildSpeciesMap", () => {
  it("maps shortCode to species via the slugified full name", () => {
    const bundle = { "rosa-rubiginosa": species() };
    const map = buildSpeciesMap(
      [record({ shortCode: "rose", fullName: "Rosa rubiginosa" })],
      bundle
    );
    expect(map.get("rose")).toBe(bundle["rosa-rubiginosa"]);
  });

  it("skips records without a full name", () => {
    const map = buildSpeciesMap(
      [record({ shortCode: "rose", fullName: null })],
      { "rosa-rubiginosa": species() }
    );
    expect(map.has("rose")).toBe(false);
  });

  it("skips records whose slug is absent from the bundle", () => {
    const map = buildSpeciesMap(
      [record({ shortCode: "rose", fullName: "Unknown plant" })],
      { "rosa-rubiginosa": species() }
    );
    expect(map.size).toBe(0);
  });

  it("includes only the records that resolve", () => {
    const sp = species();
    const map = buildSpeciesMap(
      [
        record({ shortCode: "a", fullName: "Rosa rubiginosa" }),
        record({ shortCode: "b", fullName: null }),
        record({ shortCode: "c", fullName: "No match" }),
      ],
      { "rosa-rubiginosa": sp }
    );
    expect([...map.keys()]).toEqual(["a"]);
  });
});
