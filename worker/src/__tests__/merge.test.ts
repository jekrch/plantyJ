import { describe, it, expect } from "bun:test";
import { mergeShortCodes } from "../batch";
import type { BatchState } from "../github";

function makeState(overrides: Partial<BatchState> = {}): BatchState {
  return {
    gallery: { pics: [], plants: [], zones: [], zonePics: [] },
    annotations: [],
    relationships: { types: [], relationships: [] },
    picsSha: "a",
    plantsSha: "b",
    zonesSha: "c",
    zonePicsSha: "d",
    annotationsSha: "e",
    relationshipsSha: "f",
    dirty: new Set(),
    imagesToDelete: [],
    ...overrides,
  };
}

describe("mergeShortCodes", () => {
  it("repoints pics, drops the source plant, and backfills blank survivor fields", () => {
    const state = makeState({
      gallery: {
        pics: [
          { seq: 1, id: "x", shortCode: "V virgi", zoneCode: "fy", tags: [], image: "i", description: null } as any,
          { seq: 2, id: "y", shortCode: "V virg", zoneCode: "fy", tags: [], image: "j", description: null } as any,
        ],
        plants: [
          { shortCode: "V virgi", fullName: "Vanessa virginiensis", commonName: "American Lady Butterfly", variety: null },
          { shortCode: "V virg", fullName: null, commonName: "American Lady", variety: null },
        ],
        zones: [],
        zonePics: [],
      },
    });

    const r = mergeShortCodes(state, "V virgi", "V virg");
    expect(r.ok).toBe(true);
    // pic repointed
    expect(state.gallery.pics.map((p) => p.shortCode).sort()).toEqual(["V virg", "V virg"]);
    // source plant gone, survivor kept, blank fullName backfilled
    expect(state.gallery.plants).toHaveLength(1);
    expect(state.gallery.plants[0]).toEqual({
      shortCode: "V virg",
      fullName: "Vanessa virginiensis",
      commonName: "American Lady",
      variety: null,
    });
    expect(state.dirty.has("pics")).toBe(true);
    expect(state.dirty.has("plants")).toBe(true);
  });

  it("unions annotation tags and keeps the survivor's description", () => {
    const state = makeState({
      annotations: [
        { shortCode: "V virg", zoneCode: null, tags: ["native"], description: "keep me" },
        { shortCode: "V virgi", zoneCode: null, tags: ["native", "host"], description: "drop me" },
      ],
    });
    mergeShortCodes(state, "V virgi", "V virg");
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0].tags.sort()).toEqual(["host", "native"]);
    expect(state.annotations[0].description).toBe("keep me");
    expect(state.dirty.has("annotations")).toBe(true);
  });

  it("rewrites relationship endpoints, drops self-loops, and dedups", () => {
    const state = makeState({
      relationships: {
        types: [
          { id: "pollinator", name: "Pollinator", description: "", directional: true },
          { id: "companion", name: "Companion", description: "", directional: false },
        ],
        relationships: [
          { id: 1, type: "pollinator", from: "V virgi", to: "A scr" },
          { id: 2, type: "pollinator", from: "V virg", to: "A scr" }, // dup after merge
          { id: 3, type: "companion", from: "V virgi", to: "V virg" }, // becomes self-loop
          { id: 4, type: "companion", from: "B imp", to: "V virgi" }, // unordered dup of #5
          { id: 5, type: "companion", from: "V virg", to: "B imp" },
        ],
      },
    });
    mergeShortCodes(state, "V virgi", "V virg");
    const rels = state.relationships.relationships;
    // no self-loops
    expect(rels.some((r) => r.from === r.to)).toBe(false);
    // no remaining reference to the merged code
    expect(rels.some((r) => r.from === "V virgi" || r.to === "V virgi")).toBe(false);
    // pollinator V virg→A scr deduped to one; companion V virg↔B imp deduped to one
    expect(rels.filter((r) => r.type === "pollinator" && r.from === "V virg" && r.to === "A scr")).toHaveLength(1);
    expect(rels.filter((r) => r.type === "companion")).toHaveLength(1);
    expect(state.dirty.has("relationships")).toBe(true);
  });

  it("renames the source plant when no survivor record exists", () => {
    const state = makeState({
      gallery: {
        pics: [],
        plants: [{ shortCode: "old", fullName: "F", commonName: "C", variety: null }],
        zones: [],
        zonePics: [],
      },
    });
    const r = mergeShortCodes(state, "old", "new");
    expect(r.ok).toBe(true);
    expect(state.gallery.plants).toEqual([{ shortCode: "new", fullName: "F", commonName: "C", variety: null }]);
  });

  it("rejects self-merge and unknown source", () => {
    expect(mergeShortCodes(makeState(), "a", "a").ok).toBe(false);
    expect(mergeShortCodes(makeState(), "ghost", "real").ok).toBe(false);
  });
});
