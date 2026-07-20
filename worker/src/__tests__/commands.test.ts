import { describe, it, expect } from "bun:test";
import {
  parseComboCommand,
  parseConfirmIndices,
  parseTagCommand,
} from "../commands/parse";
import {
  buildPlantsText,
  buildTagsText,
  buildZonesText,
  joinLines,
} from "../commands/format";
import type { AnnotationEntry, PicEntry, PlantRecord, Zone } from "../types";

function pic(tags: string[]): PicEntry {
  return {
    seq: 1,
    id: "p1",
    shortCode: "tmt-c",
    zoneCode: "fb1",
    tags,
    description: null,
    image: "images/x.jpg",
    postedBy: "jacob",
    addedAt: "2026-07-19T00:00:00Z",
  };
}

function annotation(tags: string[]): AnnotationEntry {
  return { shortCode: "tmt-c", zoneCode: null, tags, description: null };
}

describe("parseConfirmIndices", () => {
  it("treats a bare /confirm as 'all'", () => {
    expect(parseConfirmIndices("/confirm", 3)).toBe("all");
    expect(parseConfirmIndices("/confirm   ", 3)).toBe("all");
  });

  it("accepts space- and comma-separated selections", () => {
    expect(parseConfirmIndices("/confirm 1 3", 3)).toEqual([1, 3]);
    expect(parseConfirmIndices("/confirm 1,3", 3)).toEqual([1, 3]);
    expect(parseConfirmIndices("/confirm 1, 2 ,3", 3)).toEqual([1, 2, 3]);
  });

  it("preserves the order the user typed", () => {
    expect(parseConfirmIndices("/confirm 3 1 2", 3)).toEqual([3, 1, 2]);
  });

  it("de-duplicates repeats so a command never runs twice", () => {
    expect(parseConfirmIndices("/confirm 2 2 2", 3)).toEqual([2]);
  });

  it("rejects out-of-range indices", () => {
    expect(parseConfirmIndices("/confirm 0", 3)).toBe("invalid");
    expect(parseConfirmIndices("/confirm 4", 3)).toBe("invalid");
    expect(parseConfirmIndices("/confirm -1", 3)).toBe("invalid");
  });

  it("rejects one bad index even when the rest are fine", () => {
    expect(parseConfirmIndices("/confirm 1 99", 3)).toBe("invalid");
  });

  it("rejects non-integers rather than silently coercing", () => {
    // parseInt would happily return 1 for each of these.
    expect(parseConfirmIndices("/confirm 1.5", 3)).toBe("invalid");
    expect(parseConfirmIndices("/confirm 1abc", 3)).toBe("invalid");
    expect(parseConfirmIndices("/confirm 01", 3)).toBe("invalid");
    expect(parseConfirmIndices("/confirm abc", 3)).toBe("invalid");
  });

  it("rejects any selection when there is nothing to select", () => {
    expect(parseConfirmIndices("/confirm 1", 0)).toBe("invalid");
  });
});

describe("parseTagCommand", () => {
  it("reads a numeric first token as a pic seq", () => {
    expect(parseTagCommand("12 edible")).toEqual({ kind: "pic", seq: 12, tag: "edible" });
  });

  it("keeps the rest of the line as the tag, spaces and all", () => {
    expect(parseTagCommand("12 needs staking")).toEqual({
      kind: "pic",
      seq: 12,
      tag: "needs staking",
    });
  });

  it("reads a non-numeric first token as a plant shortCode", () => {
    expect(parseTagCommand("tmt-c edible")).toEqual({
      kind: "annotation",
      shortCode: "tmt-c",
      zoneCode: null,
      tag: "edible",
    });
  });

  // parseInt("12abc") is 12, so the String() round-trip is what keeps a
  // shortCode that merely starts with digits from being read as a seq.
  it("does not mistake a digit-leading shortCode for a seq", () => {
    expect(parseTagCommand("12abc edible")).toEqual({
      kind: "annotation",
      shortCode: "12abc",
      zoneCode: null,
      tag: "edible",
    });
  });

  it("reads two // segments as a plant-wide annotation", () => {
    expect(parseTagCommand("tmt-c // heirloom")).toEqual({
      kind: "annotation",
      shortCode: "tmt-c",
      zoneCode: null,
      tag: "heirloom",
    });
  });

  it("reads three // segments as a plant+zone annotation", () => {
    expect(parseTagCommand("tmt-c // fb1 // heirloom")).toEqual({
      kind: "annotation",
      shortCode: "tmt-c",
      zoneCode: "fb1",
      tag: "heirloom",
    });
  });

  it("rejects a single token with no tag", () => {
    expect(parseTagCommand("tmt-c")).toEqual({ kind: "invalid" });
    expect(parseTagCommand("")).toEqual({ kind: "invalid" });
  });

  it("rejects more than three segments", () => {
    expect(parseTagCommand("a // b // c // d")).toEqual({ kind: "invalid" });
  });
});

describe("parseComboCommand", () => {
  it("accepts exactly a shortCode and a zoneCode", () => {
    expect(parseComboCommand("tmt-c // fb1")).toEqual({ shortCode: "tmt-c", zoneCode: "fb1" });
  });

  it("rejects a missing zone — removal is always scoped to a pairing", () => {
    expect(parseComboCommand("tmt-c")).toBeNull();
    expect(parseComboCommand("tmt-c //")).toBeNull();
    expect(parseComboCommand("")).toBeNull();
  });

  it("rejects a third segment", () => {
    expect(parseComboCommand("tmt-c // fb1 // extra")).toBeNull();
  });
});

describe("joinLines", () => {
  it("drops null, undefined, false, and empty entries", () => {
    expect(joinLines(["a", null, "b", undefined, false, "", "c"])).toBe("a\nb\nc");
  });

  it("returns an empty string when nothing survives", () => {
    expect(joinLines([null, false, undefined])).toBe("");
  });
});

describe("buildPlantsText", () => {
  const plants: PlantRecord[] = [
    { shortCode: "zin", fullName: "Zinnia elegans", commonName: null },
    { shortCode: "bas", fullName: "Ocimum basilicum", commonName: "Basil" },
    { shortCode: "mys", fullName: null, commonName: null },
  ];

  it("reports an empty collection plainly", () => {
    expect(buildPlantsText([])).toBe("No plants yet.");
  });

  it("sorts by shortCode and prefers commonName, then fullName, then the code", () => {
    expect(buildPlantsText(plants)).toBe(
      "Plants:\n  bas — Basil\n  mys — mys\n  zin — Zinnia elegans",
    );
  });

  it("does not mutate the caller's array", () => {
    const order = plants.map((p) => p.shortCode);
    buildPlantsText(plants);
    expect(plants.map((p) => p.shortCode)).toEqual(order);
  });
});

describe("buildTagsText", () => {
  it("reports an empty tag set plainly", () => {
    expect(buildTagsText([], [])).toBe("No tags yet.");
    expect(buildTagsText([pic([])], [annotation([])])).toBe("No tags yet.");
  });

  it("unions tags across pics and annotations, sorted and de-duplicated", () => {
    const text = buildTagsText([pic(["native", "edible"])], [annotation(["edible", "shade"])]);
    expect(text).toBe("Tags:\n  edible\n  native\n  shade");
  });
});

describe("buildZonesText", () => {
  it("points at /addzone when there are none", () => {
    expect(buildZonesText([])).toBe("No zones yet. Add one with /addzone {code} {name}.");
  });

  it("sorts by code and marks unnamed zones", () => {
    const zones: Zone[] = [
      { code: "mp", name: null },
      { code: "fb1", name: "Front Bed 1" },
    ];
    expect(buildZonesText(zones)).toBe("Zones:\n  fb1 — Front Bed 1\n  mp — (unnamed)");
  });
});
