import { describe, it, expect } from "bun:test";
import { buildParams } from "../hooks/useFilterParams";
import { EMPTY_FILTERS, type Filters } from "../utils/filtering";

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...EMPTY_FILTERS, ...overrides };
}

function parse(qs: string): URLSearchParams {
  return new URLSearchParams(qs);
}

describe("buildParams", () => {
  it("emits nothing for empty filters at the default sort and view", () => {
    expect(buildParams(filters(), "newest", "gallery", null)).toBe("");
  });

  it("serializes set filters under their URL param names", () => {
    const p = parse(
      buildParams(
        filters({
          tags: new Set(["a", "b"]),
          zoneCodes: new Set(["Z1"]),
          shortCodes: new Set(["rose"]),
          aiVerdicts: new Set(["good"]),
        }),
        "newest",
        "gallery",
        null
      )
    );
    expect(p.get("tags")).toBe("a,b");
    expect(p.get("zones")).toBe("Z1");
    expect(p.get("plants")).toBe("rose");
    expect(p.get("ecoFit")).toBe("good");
  });

  it("includes a non-empty trimmed search query", () => {
    const p = parse(
      buildParams(filters({ searchQuery: "fern" }), "newest", "gallery", null)
    );
    expect(p.get("q")).toBe("fern");
  });

  it("omits the search query when it is only whitespace", () => {
    const p = parse(
      buildParams(filters({ searchQuery: "   " }), "newest", "gallery", null)
    );
    expect(p.has("q")).toBe(false);
  });

  it("emits the sort param only when it differs from the default", () => {
    expect(parse(buildParams(filters(), "newest", "gallery", null)).has("sort")).toBe(
      false
    );
    expect(parse(buildParams(filters(), "oldest", "gallery", null)).get("sort")).toBe(
      "oldest"
    );
  });

  it("emits the view and subject for a plant spotlight", () => {
    const p = parse(buildParams(filters(), "newest", "plant", "rose"));
    expect(p.get("view")).toBe("plant");
    expect(p.get("subject")).toBe("rose");
  });

  it("drops the subject when the view is the default gallery", () => {
    const p = parse(buildParams(filters(), "newest", "gallery", "rose"));
    expect(p.has("view")).toBe(false);
    expect(p.has("subject")).toBe(false);
  });

  it("includes treeNode only for the tree view", () => {
    expect(
      parse(buildParams(filters(), "newest", "tree", null, "Rosa")).get(
        "treeNode"
      )
    ).toBe("Rosa");
    expect(
      parse(buildParams(filters(), "newest", "plant", "rose", "Rosa")).has(
        "treeNode"
      )
    ).toBe(false);
  });

  it("includes webNode only for the web view", () => {
    expect(
      parse(buildParams(filters(), "newest", "web", null, null, "rose")).get(
        "webNode"
      )
    ).toBe("rose");
    expect(
      parse(
        buildParams(filters(), "newest", "tree", null, "Rosa", "rose")
      ).has("webNode")
    ).toBe(false);
  });
});
