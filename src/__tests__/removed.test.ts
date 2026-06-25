import { describe, it, expect } from "bun:test";
import {
  buildRemovedSet,
  isOrganismRemoved,
  activeOrganisms,
  fullyRemovedShortCodes,
  removedComboKey,
} from "../utils/removed";
import type { Annotation } from "../types";
import { organism } from "./helpers";

function ann(overrides: Partial<Annotation>): Annotation {
  return { shortCode: "x", zoneCode: null, tags: [], description: null, ...overrides };
}

describe("buildRemovedSet", () => {
  it("includes only removed plant+zone combos (non-null zoneCode)", () => {
    const set = buildRemovedSet([
      ann({ shortCode: "r rub", zoneCode: "bb", removed: true }),
      ann({ shortCode: "r rub", zoneCode: "fy", removed: false }),
      ann({ shortCode: "a tri", zoneCode: null, removed: true }), // plant-level: ignored
      ann({ shortCode: "s can", zoneCode: "kg" }), // not removed
    ]);
    expect(set.has(removedComboKey("r rub", "bb"))).toBe(true);
    expect(set.has(removedComboKey("r rub", "fy"))).toBe(false);
    expect(set.size).toBe(1); // plant-level (null-zone) removal is ignored
  });
});

describe("isOrganismRemoved / activeOrganisms", () => {
  it("flags pics in a removed combo and filters them out", () => {
    const removedHere = organism({ shortCode: "r rub", zoneCode: "bb" });
    const keptOtherZone = organism({ shortCode: "r rub", zoneCode: "fy" });
    const keptOther = organism({ shortCode: "a tri", zoneCode: "bb" });
    const set = buildRemovedSet([ann({ shortCode: "r rub", zoneCode: "bb", removed: true })]);

    expect(isOrganismRemoved(removedHere, set)).toBe(true);
    expect(isOrganismRemoved(keptOtherZone, set)).toBe(false);

    const active = activeOrganisms([removedHere, keptOtherZone, keptOther], set);
    expect(active).toEqual([keptOtherZone, keptOther]);
  });

  it("returns the same array reference when nothing is removed", () => {
    const list = [organism()];
    expect(activeOrganisms(list, new Set())).toBe(list);
  });
});

describe("fullyRemovedShortCodes", () => {
  it("only includes plants with no remaining active pic in any zone", () => {
    const orgs = [
      organism({ shortCode: "r rub", zoneCode: "bb" }), // removed
      organism({ shortCode: "r rub", zoneCode: "fy" }), // still active → plant stays
      organism({ shortCode: "dead", zoneCode: "bb" }), // removed, only zone → fully gone
    ];
    const set = buildRemovedSet([
      ann({ shortCode: "r rub", zoneCode: "bb", removed: true }),
      ann({ shortCode: "dead", zoneCode: "bb", removed: true }),
    ]);
    const fully = fullyRemovedShortCodes(orgs, set);
    expect(fully.has("dead")).toBe(true);
    expect(fully.has("r rub")).toBe(false);
    expect(fully.size).toBe(1);
  });
});
