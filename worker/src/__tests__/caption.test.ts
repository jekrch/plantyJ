import { describe, it, expect } from "bun:test";
import {
  parseCaption,
  generateShortCode,
  slugify,
  isUnidentifiedShortCode,
  resolveFields,
  UNIDENTIFIED_CODE,
} from "../caption";
import type { PicEntry, PlantRecord, Zone } from "../types";

describe("slugify", () => {
  it("lowercases and replaces non-alphanumerics with hyphens", () => {
    expect(slugify("Thymus serpyllum")).toBe("thymus-serpyllum");
    expect(slugify("  Acer palmatum 'Bloodgood' ")).toBe("acer-palmatum-bloodgood");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("---foo---")).toBe("foo");
  });

  it("collapses runs of separators", () => {
    expect(slugify("a   b__c!!d")).toBe("a-b-c-d");
  });
});

describe("isUnidentifiedShortCode", () => {
  it("returns true for unid- prefixed codes", () => {
    expect(isUnidentifiedShortCode("unid-42")).toBe(true);
    expect(isUnidentifiedShortCode("unid-")).toBe(true);
  });

  it("returns false for other codes", () => {
    expect(isUnidentifiedShortCode("tmt-c")).toBe(false);
    expect(isUnidentifiedShortCode("id")).toBe(false);
    expect(isUnidentifiedShortCode("")).toBe(false);
  });
});

describe("generateShortCode", () => {
  it("uses genus initial + first 3 of epithet", () => {
    expect(generateShortCode("Thymus serpyllum", null, new Set())).toBe("T ser");
  });

  it("appends first 3 of variety when present", () => {
    expect(generateShortCode("Viola sororia", "priceana", new Set())).toBe("V sor pri");
  });

  it("extends the epithet on collision", () => {
    const taken = new Set(["V vir"]);
    expect(generateShortCode("Viola virginiana", null, taken)).toBe("V virg");
  });

  it("extends further when multiple collisions occur", () => {
    const taken = new Set(["V vir", "V virg", "V virgi"]);
    expect(generateShortCode("Viola virginiana", null, taken)).toBe("V virgin");
  });

  it("falls back to numeric suffix when the epithet is exhausted", () => {
    // After exhausting "ser" → "serp" → ... → "serpyllum", numeric suffix.
    const taken = new Set([
      "T ser",
      "T serp",
      "T serpy",
      "T serpyl",
      "T serpyll",
      "T serpyllu",
      "T serpyllum",
    ]);
    expect(generateShortCode("Thymus serpyllum", null, taken)).toBe("T serpyllum-2");
  });

  it("strips non-letters from the species words", () => {
    expect(generateShortCode("Quercus 'macro'carpa", null, new Set())).toBe("Q mac");
  });

  it("handles a single-word fullName by reusing it as the epithet", () => {
    expect(generateShortCode("Mint", null, new Set())).toBe("M min");
  });
});

describe("parseCaption", () => {
  it("parses a full caption", () => {
    const p = parseCaption(
      "tmt-c // Solanum lycopersicum 'Cherokee Purple' // Cherokee Purple Tomato // Front Bed 1 (fb1) // edible,heirloom // first ripe fruit",
    );
    expect(p.shortCode).toBe("tmt-c");
    expect(p.autoCode).toBe(false);
    expect(p.fullName).toBe("Solanum lycopersicum");
    expect(p.variety).toBe("Cherokee Purple");
    expect(p.commonName).toBe("Cherokee Purple Tomato");
    expect(p.zone).toEqual({ code: "fb1", name: "Front Bed 1" });
    expect(p.tags).toEqual({ picTags: ["edible", "heirloom"], zoneTags: [], plantTags: [] });
    expect(p.description).toBe("first ripe fruit");
  });

  it("parses bare zone codes (no display name)", () => {
    const p = parseCaption("tmt-c // // // fb1");
    expect(p.zone).toEqual({ code: "fb1", name: null });
  });

  it("classifies tags by prefix: pic (none), zone (+), plant (++)", () => {
    const p = parseCaption("tmt-c // // // fb1 // edible,+native,++medicinal");
    expect(p.tags).toEqual({
      picTags: ["edible"],
      zoneTags: ["native"],
      plantTags: ["medicinal"],
    });
  });

  it("flags autoCode when the leading shortCode segment is empty", () => {
    const p = parseCaption("// Thymus serpyllum // Creeping Thyme // fb1");
    expect(p.autoCode).toBe(true);
    expect(p.shortCode).toBe("");
    expect(p.fullName).toBe("Thymus serpyllum");
  });

  it("treats shortCode 'id' as unidentified and collapses the schema", () => {
    const p = parseCaption("id // fb1 // mystery plant");
    expect(p.shortCode).toBe(UNIDENTIFIED_CODE);
    expect(p.fullName).toBeNull();
    expect(p.commonName).toBeNull();
    expect(p.zone).toEqual({ code: "fb1", name: null });
    expect(p.description).toBe("mystery plant");
    expect(p.tags).toBeNull();
  });

  it("'id' is case-insensitive", () => {
    const p = parseCaption("ID // fb1");
    expect(p.shortCode).toBe(UNIDENTIFIED_CODE);
  });

  it("rejects an invalid shortCode", () => {
    expect(() => parseCaption("../etc // foo")).toThrow(/shortCode/);
  });

  it("rejects multi-zone captions (+ in zone segment)", () => {
    expect(() => parseCaption("tmt-c // // // fb1+fb2")).toThrow(/one zone/);
  });

  it("rejects an invalid zoneCode", () => {
    expect(() => parseCaption("tmt-c // // // ../etc")).toThrow(/zoneCode/);
  });

  it("returns null for omitted optional segments", () => {
    const p = parseCaption("tmt-c");
    expect(p.fullName).toBeNull();
    expect(p.commonName).toBeNull();
    expect(p.zone).toBeNull();
    expect(p.tags).toBeNull();
    expect(p.description).toBeNull();
  });

  it("extracts variety from a trailing quoted token", () => {
    const p = parseCaption("a // Acer palmatum 'Bloodgood'");
    expect(p.fullName).toBe("Acer palmatum");
    expect(p.variety).toBe("Bloodgood");
  });
});

describe("resolveFields", () => {
  const zones: Zone[] = [{ code: "fb1", name: "Front Bed 1" }];

  it("registers a brand-new plant + pic when both are unknown", () => {
    const result = resolveFields(
      parseCaption(
        "tmt-c // Solanum lycopersicum // Cherokee Purple Tomato // Front Bed 1 (fb1)",
      ),
      [],
      [],
      [],
    );
    expect(result.pic.shortCode).toBe("tmt-c");
    expect(result.pic.zoneCode).toBe("fb1");
    expect(result.plantUpsert).toEqual({
      shortCode: "tmt-c",
      fullName: "Solanum lycopersicum",
      commonName: "Cherokee Purple Tomato",
      variety: null,
    });
    // Zone is being declared for the first time, so it's upserted.
    expect(result.zoneUpserts).toEqual([{ code: "fb1", name: "Front Bed 1" }]);
  });

  it("inherits the zone from the most recent prior pic when omitted", () => {
    const pics: PicEntry[] = [
      {
        seq: 1,
        id: "pic-1",
        shortCode: "tmt-c",
        zoneCode: "fb1",
        tags: ["edible"],
        description: null,
        image: "img.jpg",
        postedBy: "u",
        addedAt: "2026-01-01",
      },
    ];
    const plants: PlantRecord[] = [
      { shortCode: "tmt-c", fullName: "Solanum lycopersicum", commonName: null, variety: null },
    ];
    const result = resolveFields(parseCaption("tmt-c"), pics, plants, zones);
    expect(result.pic.zoneCode).toBe("fb1");
    expect(result.pic.tags).toEqual(["edible"]); // inherited from prior pic
    expect(result.plantUpsert).toBeNull(); // plant already complete
  });

  it("auto-generates a shortCode from the species name", () => {
    const result = resolveFields(
      parseCaption("// Thymus serpyllum // Creeping Thyme // fb1"),
      [],
      [],
      zones,
    );
    expect(result.pic.shortCode).toBe("T ser");
    expect(result.plantUpsert?.shortCode).toBe("T ser");
    // Existing zone — no upsert.
    expect(result.zoneUpserts).toEqual([]);
  });

  it("throws when autoCode is set but no fullName is supplied", () => {
    expect(() => resolveFields(parseCaption("// // // fb1"), [], [], zones)).toThrow(
      /species name/,
    );
  });

  it("throws on shortCode collision with a different botanical name", () => {
    const plants: PlantRecord[] = [
      { shortCode: "tmt-c", fullName: "Solanum lycopersicum", commonName: null, variety: null },
    ];
    expect(() =>
      resolveFields(parseCaption("tmt-c // Capsicum annuum // // fb1"), [], plants, zones),
    ).toThrow(/already taken/);
  });

  it("backfills missing plant fields without overwriting existing ones", () => {
    const plants: PlantRecord[] = [
      { shortCode: "tmt-c", fullName: "Solanum lycopersicum", commonName: null, variety: null },
    ];
    const result = resolveFields(
      parseCaption("tmt-c // Solanum lycopersicum // Cherry Tomato // fb1"),
      [],
      plants,
      zones,
    );
    expect(result.plantUpsert).toEqual({
      shortCode: "tmt-c",
      fullName: "Solanum lycopersicum",
      commonName: "Cherry Tomato",
      variety: null,
    });
  });

  it("requires a zone for new plants", () => {
    expect(() =>
      resolveFields(parseCaption("newp // Foo bar // Common"), [], [], zones),
    ).toThrow(/needs a zone/);
  });

  it("handles unidentified pics: no plant upsert, empty tags, zone required", () => {
    const result = resolveFields(parseCaption("id // fb1 // mystery"), [], [], zones);
    expect(result.pic.shortCode).toBe(UNIDENTIFIED_CODE);
    expect(result.pic.zoneCode).toBe("fb1");
    expect(result.pic.tags).toEqual([]);
    expect(result.pic.description).toBe("mystery");
    expect(result.plantUpsert).toBeNull();
  });

  it("unidentified pics require a zone", () => {
    expect(() => resolveFields(parseCaption("id"), [], [], zones)).toThrow(/zone/);
  });

  it("queues a rename when the caption supplies a new zone display name", () => {
    const result = resolveFields(
      parseCaption("tmt-c // Solanum lycopersicum // // Front Garden (fb1)"),
      [],
      [],
      zones,
    );
    expect(result.zoneUpserts).toEqual([{ code: "fb1", name: "Front Garden" }]);
  });

  it("extracts plant/zone annotation tags from + and ++ prefixes", () => {
    const result = resolveFields(
      parseCaption("tmt-c // Solanum lycopersicum // // fb1 // edible,+native,++medicinal"),
      [],
      [],
      zones,
    );
    expect(result.pic.tags).toEqual(["edible"]);
    expect(result.annotationTags).toEqual({
      plantTags: ["medicinal"],
      zoneTags: ["native"],
    });
  });
});
