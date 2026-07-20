import { describe, it, expect } from "bun:test";
import {
  CANVAS_H,
  CANVAS_W,
  NODE_R,
  edgeGeometry,
  nodeAt,
  runLayout,
  type Pt,
} from "../components/RelationshipEditor/layout";

describe("runLayout", () => {
  it("returns nothing for an empty node set", () => {
    expect(runLayout([], [], new Map()).size).toBe(0);
  });

  it("centres a lone node and seeds the cache", () => {
    const cache = new Map<string, Pt>();
    const pos = runLayout(["a"], [], cache);
    expect(pos.get("a")).toEqual({ x: CANVAS_W / 2, y: CANVAS_H / 2 });
    expect(cache.get("a")).toEqual({ x: CANVAS_W / 2, y: CANVAS_H / 2 });
  });

  it("reuses a cached position for a lone node instead of recentring it", () => {
    const cache = new Map<string, Pt>([["a", { x: 12, y: 34 }]]);
    expect(runLayout(["a"], [], cache).get("a")).toEqual({ x: 12, y: 34 });
  });

  it("places every node and writes them all back to the cache", () => {
    const cache = new Map<string, Pt>();
    const codes = ["a", "b", "c", "d"];
    const pos = runLayout(codes, [["a", "b"]], cache);
    for (const c of codes) {
      expect(pos.get(c)).toBeDefined();
      expect(Number.isFinite(pos.get(c)!.x)).toBe(true);
      expect(Number.isFinite(pos.get(c)!.y)).toBe(true);
      expect(cache.has(c)).toBe(true);
    }
  });

  it("keeps a mostly-cached arrangement near where it was", () => {
    const cache = new Map<string, Pt>();
    const codes = ["a", "b", "c", "d"];
    const first = runLayout(codes, [["a", "b"]], cache);

    // Adding one node should relax the existing layout, not reshuffle it.
    const second = runLayout([...codes, "e"], [["a", "b"]], cache);
    for (const c of codes) {
      const d = Math.hypot(
        second.get(c)!.x - first.get(c)!.x,
        second.get(c)!.y - first.get(c)!.y,
      );
      expect(d).toBeLessThan(400);
    }
  });

  it("ignores edges pointing at nodes that aren't on the canvas", () => {
    const pos = runLayout(["a", "b"], [["a", "ghost"]], new Map());
    expect(pos.size).toBe(2);
    expect(Number.isFinite(pos.get("a")!.x)).toBe(true);
  });

  it("separates unconnected nodes rather than stacking them", () => {
    const pos = runLayout(["a", "b"], [], new Map());
    const d = Math.hypot(pos.get("a")!.x - pos.get("b")!.x, pos.get("a")!.y - pos.get("b")!.y);
    expect(d).toBeGreaterThan(NODE_R);
  });
});

describe("edgeGeometry", () => {
  const a: Pt = { x: 0, y: 0 };
  const b: Pt = { x: 100, y: 0 };

  it("draws a lone edge straight through the midpoint", () => {
    const g = edgeGeometry(a, b, 0, 1, false);
    expect(g.path).toBe("M 0 0 Q 50 0 100 0");
    expect(g.labelX).toBe(50);
    expect(g.labelY).toBe(0);
    expect(g.angle).toBe(0);
  });

  it("swaps endpoints when reversed, so the arrowhead lands on the right node", () => {
    expect(edgeGeometry(a, b, 0, 1, true).path).toBe("M 100 0 Q 50 0 0 0");
  });

  it("fans a parallel bundle symmetrically about the straight line", () => {
    const [lo, hi] = [edgeGeometry(a, b, 0, 2, false), edgeGeometry(a, b, 1, 2, false)];
    expect(lo.labelY).toBeCloseTo(-hi.labelY);
    expect(lo.labelY).not.toBe(0);
    // Both still start and end at the endpoints; only the bow differs.
    expect(lo.path.startsWith("M 0 0")).toBe(true);
    expect(lo.path.endsWith("100 0")).toBe(true);
  });

  it("leaves the middle edge of an odd bundle unbowed", () => {
    expect(edgeGeometry(a, b, 1, 3, false).labelY).toBe(0);
  });

  it("clamps the label angle so text never reads upside-down", () => {
    for (const target of [
      { x: -100, y: 0 },
      { x: -100, y: -100 },
      { x: 0, y: -100 },
      { x: 100, y: 100 },
    ]) {
      const { angle } = edgeGeometry(a, target, 0, 1, false);
      expect(angle).toBeGreaterThanOrEqual(-90);
      expect(angle).toBeLessThanOrEqual(90);
    }
  });

  it("survives coincident endpoints without producing NaN", () => {
    const g = edgeGeometry(a, { ...a }, 0, 2, false);
    expect(Number.isFinite(g.labelX)).toBe(true);
    expect(Number.isFinite(g.labelY)).toBe(true);
    expect(g.path).not.toContain("NaN");
  });
});

describe("nodeAt", () => {
  const positions = new Map<string, Pt>([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 500, y: 500 }],
  ]);

  it("hits a node the cursor is sitting on", () => {
    expect(nodeAt({ x: 0, y: 0 }, positions)).toBe("a");
  });

  it("hits within the grab radius but not beyond it", () => {
    expect(nodeAt({ x: NODE_R, y: 0 }, positions)).toBe("a");
    expect(nodeAt({ x: NODE_R + 200, y: 0 }, positions)).toBeNull();
  });

  it("returns null on empty space", () => {
    expect(nodeAt({ x: 9999, y: 9999 }, positions)).toBeNull();
  });

  it("picks the nearest when two are in range", () => {
    const close = new Map<string, Pt>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 12, y: 0 }],
    ]);
    expect(nodeAt({ x: 11, y: 0 }, close)).toBe("b");
  });

  it("returns null for an empty canvas", () => {
    expect(nodeAt({ x: 0, y: 0 }, new Map())).toBeNull();
  });
});
