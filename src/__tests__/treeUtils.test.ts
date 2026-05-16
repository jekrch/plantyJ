import { describe, it, expect } from "bun:test";
import { speciesPicsFor, buildTree, linkPath } from "../components/TreeView/treeUtils";
import type { Organism, Species } from "../types";
import type { RawNode } from "../components/TreeView/types";
import { organism } from "./helpers";

function makeSpecies(shortCode: string, overrides: Partial<Species> = {}): [string, Species] {
  return [
    shortCode,
    {
      id: shortCode,
      fullName: null,
      commonName: null,
      description: null,
      vernacularNames: [],
      nativeRange: null,
      references: [],
      sources: [],
      taxonomy: {
        kingdom: "Plantae",
        phylum: "Tracheophyta",
        class: "Magnoliopsida",
        order: "Rosales",
        family: "Rosaceae",
        genus: "Rosa",
        species: `Rosa ${shortCode}`,
        canonicalName: `Rosa ${shortCode}`,
      },
      ...overrides,
    },
  ];
}

describe("speciesPicsFor", () => {
  const organisms: Organism[] = [
    organism({ id: "a", shortCode: "rosa", addedAt: "2024-01-01T00:00:00Z" }),
    organism({ id: "b", shortCode: "rosa", addedAt: "2024-06-01T00:00:00Z" }),
    organism({ id: "c", shortCode: "iris", addedAt: "2024-03-01T00:00:00Z" }),
  ];

  it("returns only plants matching the shortCode", () => {
    const result = speciesPicsFor(organisms, "rosa");
    expect(result.every((p) => p.shortCode === "rosa")).toBe(true);
    expect(result.map((p) => p.id)).not.toContain("c");
  });

  it("sorts results newest first", () => {
    const result = speciesPicsFor(organisms, "rosa");
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("a");
  });

  it("returns empty array for an unknown shortCode", () => {
    expect(speciesPicsFor(organisms, "unknown")).toEqual([]);
  });

  it("returns all entries when every plant has the same shortCode", () => {
    const same = [
      organism({ id: "x", shortCode: "oak" }),
      organism({ id: "y", shortCode: "oak" }),
    ];
    expect(speciesPicsFor(same, "oak")).toHaveLength(2);
  });
});

describe("buildTree", () => {
  const p1 = organism({ id: "r1", shortCode: "rosa", addedAt: "2024-01-01T00:00:00Z" });
  const p2 = organism({ id: "i1", shortCode: "iris", addedAt: "2024-01-01T00:00:00Z" });
  const pUnknown = organism({ id: "u1", shortCode: "unid-1", addedAt: "2024-01-01T00:00:00Z" });

  const speciesMap = new Map<string, Species>([
    makeSpecies("rosa", {
      taxonomy: {
        kingdom: "Plantae", phylum: "Tracheophyta", class: "Magnoliopsida",
        order: "Rosales", family: "Rosaceae", genus: "Rosa", species: "Rosa canina",
        canonicalName: "Rosa canina",
      },
    }),
    makeSpecies("iris", {
      taxonomy: {
        kingdom: "Plantae", phylum: "Tracheophyta", class: "Liliopsida",
        order: "Asparagales", family: "Iridaceae", genus: "Iris", species: "Iris versicolor",
        canonicalName: "Iris versicolor",
      },
    }),
  ]);

  it("builds a root node named 'Tree of Life'", () => {
    const { root } = buildTree([p1], speciesMap);
    expect(root.name).toBe("Tree of Life");
  });

  it("places plants with taxonomy into the tree", () => {
    const { root, missing } = buildTree([p1, p2], speciesMap);
    expect(missing).toHaveLength(0);
    expect(root.children?.length).toBeGreaterThan(0);
  });

  it("puts plants with no species data into missing", () => {
    const { missing } = buildTree([pUnknown], speciesMap);
    expect(missing.map((p) => p.shortCode)).toContain("unid-1");
  });

  it("groups plants under shared taxonomy nodes", () => {
    const { root } = buildTree([p1, p2], speciesMap);
    // Both are Plantae
    const plantae = root.children?.find((c) => c.name === "Plantae");
    expect(plantae).toBeDefined();
  });

  it("assigns shortCode and plant to the leaf node", () => {
    const { root } = buildTree([p1], speciesMap);
    function findLeaf(node: RawNode): RawNode | undefined {
      if (node.shortCode) return node;
      for (const c of node.children ?? []) {
        const found = findLeaf(c);
        if (found) return found;
      }
    }
    const leaf = findLeaf(root);
    expect(leaf?.shortCode).toBe("rosa");
    expect(leaf?.organism?.id).toBe("r1");
  });

  it("picks the most-recently-added plant as species representative", () => {
    const older = organism({ id: "old", shortCode: "rosa", addedAt: "2023-01-01T00:00:00Z" });
    const newer = organism({ id: "new", shortCode: "rosa", addedAt: "2025-01-01T00:00:00Z" });
    const { root } = buildTree([older, newer], speciesMap);
    function findLeaf(node: RawNode): RawNode | undefined {
      if (node.shortCode === "rosa") return node;
      for (const c of node.children ?? []) {
        const found = findLeaf(c);
        if (found) return found;
      }
    }
    expect(findLeaf(root)?.organism?.id).toBe("new");
  });

  it("sorts children alphabetically at each level", () => {
    const { root } = buildTree([p1, p2], speciesMap);
    function checkSorted(node: RawNode) {
      if (!node.children) return;
      const names = node.children.map((c) => c.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      node.children.forEach(checkSorted);
    }
    checkSorted(root);
  });

  it("returns empty tree and all plants in missing when speciesMap is empty", () => {
    const { root, missing } = buildTree([p1, p2], new Map());
    expect(missing).toHaveLength(2);
    expect(root.children).toEqual([]);
  });
});

describe("linkPath", () => {
  it("produces a string starting with M (move-to)", () => {
    expect(linkPath({ x: 10, y: 20 }, { x: 30, y: 40 })).toMatch(/^M/);
  });

  it("contains a cubic bezier curve command C", () => {
    expect(linkPath({ x: 10, y: 20 }, { x: 30, y: 40 })).toContain("C");
  });

  it("starts at source (y,x) for horizontal tree layout", () => {
    // linkPath uses (y,x) order so the tree is drawn left-to-right
    const path = linkPath({ x: 10, y: 20 }, { x: 30, y: 40 });
    expect(path.startsWith("M20,10")).toBe(true);
  });

  it("ends at destination (y,x)", () => {
    const path = linkPath({ x: 10, y: 20 }, { x: 30, y: 40 });
    expect(path.endsWith("40,30")).toBe(true);
  });

  it("uses the midpoint of source.y and dest.y as control point x", () => {
    // src.y=0, dst.y=100 → mx=50, path should contain "50,"
    const path = linkPath({ x: 5, y: 0 }, { x: 15, y: 100 });
    expect(path).toContain("50,");
  });
});
