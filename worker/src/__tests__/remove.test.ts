import { describe, it, expect } from "bun:test";
import { applyCommand } from "../batch";
import { annotationHasContent } from "../github";
import type { BatchState } from "../github";
import type { AnnotationEntry } from "../types";

function makeState(annotations: AnnotationEntry[] = []): BatchState {
  return {
    gallery: { pics: [], plants: [], zones: [], zonePics: [] },
    annotations,
    relationships: { types: [], relationships: [] },
    picsSha: "a",
    plantsSha: "b",
    zonesSha: "c",
    zonePicsSha: "d",
    annotationsSha: "e",
    relationshipsSha: "f",
    dirty: new Set(),
    imagesToDelete: [],
  };
}

describe("/remove and /restore", () => {
  it("marks a plant+zone combo removed, creating the annotation row", () => {
    const state = makeState();
    const r = applyCommand(state, "/remove r rub // bb");
    expect(r.ok).toBe(true);
    expect(state.annotations).toEqual([
      { shortCode: "r rub", zoneCode: "bb", tags: [], description: null, removed: true },
    ]);
    expect(state.dirty.has("annotations")).toBe(true);
  });

  it("preserves existing tags/description when flagging removed", () => {
    const state = makeState([
      { shortCode: "r rub", zoneCode: "bb", tags: ["edible"], description: "note" },
    ]);
    applyCommand(state, "/remove r rub // bb");
    expect(state.annotations[0]).toEqual({
      shortCode: "r rub",
      zoneCode: "bb",
      tags: ["edible"],
      description: "note",
      removed: true,
    });
  });

  it("restore clears the flag; an otherwise-empty row is pruned on write", () => {
    const state = makeState([
      { shortCode: "r rub", zoneCode: "bb", tags: [], description: null, removed: true },
    ]);
    const r = applyCommand(state, "/restore r rub // bb");
    expect(r.ok).toBe(true);
    expect(state.annotations[0].removed).toBeUndefined();
    // commit-time pruning drops the now-contentless row
    expect(state.annotations.filter(annotationHasContent)).toHaveLength(0);
  });

  it("restore keeps a row that still has tags", () => {
    const state = makeState([
      { shortCode: "r rub", zoneCode: "bb", tags: ["edible"], description: null, removed: true },
    ]);
    applyCommand(state, "/restore r rub // bb");
    expect(state.annotations[0].removed).toBeUndefined();
    expect(state.annotations.filter(annotationHasContent)).toHaveLength(1);
  });

  it("is a no-op (no dirty, no orphan row) when removing an already-removed combo", () => {
    const state = makeState([
      { shortCode: "r rub", zoneCode: "bb", tags: [], description: null, removed: true },
    ]);
    const r = applyCommand(state, "/remove r rub // bb");
    expect(r.ok).toBe(true);
    expect(state.dirty.has("annotations")).toBe(false);
    expect(state.annotations).toHaveLength(1);
  });

  it("restoring a combo that was never removed leaves no shell row", () => {
    const state = makeState();
    const r = applyCommand(state, "/restore r rub // bb");
    expect(r.ok).toBe(true);
    expect(state.annotations).toHaveLength(0);
    expect(state.dirty.has("annotations")).toBe(false);
  });

  it("rejects a missing zoneCode", () => {
    expect(applyCommand(makeState(), "/remove r rub").ok).toBe(false);
    expect(applyCommand(makeState(), "/remove r rub //").ok).toBe(false);
  });
});
