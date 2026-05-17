import { describe, it, expect } from "bun:test";
import { resolveViewerOrganisms } from "../hooks/useOrganismViewer";
import { organism } from "./helpers";

const custom = [organism({ id: "c1" })];
const spotlight = [organism({ id: "s1" })];
const all = [organism({ id: "a1" }), organism({ id: "a2" })];
const sorted = [organism({ id: "f1" })];

const lists = { custom, spotlight, all, sorted };

describe("resolveViewerOrganisms", () => {
  it("returns the custom list for the custom scope", () => {
    expect(resolveViewerOrganisms("custom", lists)).toBe(custom);
  });

  it("falls back to the sorted list when custom scope has no list", () => {
    expect(resolveViewerOrganisms("custom", { ...lists, custom: null })).toBe(
      sorted
    );
  });

  it("returns the spotlight list for the spotlight scope", () => {
    expect(resolveViewerOrganisms("spotlight", lists)).toBe(spotlight);
  });

  it("falls back to the sorted list when the spotlight is empty", () => {
    expect(
      resolveViewerOrganisms("spotlight", { ...lists, spotlight: [] })
    ).toBe(sorted);
  });

  it("returns every organism for the all scope", () => {
    expect(resolveViewerOrganisms("all", lists)).toBe(all);
  });

  it("returns the sorted gallery list for the filtered scope", () => {
    expect(resolveViewerOrganisms("filtered", lists)).toBe(sorted);
  });

  it("ignores a populated custom list when the scope is not custom", () => {
    expect(resolveViewerOrganisms("all", lists)).toBe(all);
  });
});
