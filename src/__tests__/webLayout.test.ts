import { describe, it, expect } from "bun:test";
import {
  CANVAS_H,
  CANVAS_W,
  edgeGeometry,
  layoutGraph,
  type PositionedEdge,
  type Pt,
} from "../components/WebView/layout";
import type { Relationship } from "../types";

function rel(from: string, to: string, id = 1): Relationship {
  return { id, type: "eats", from, to };
}

function edge(overrides: Partial<PositionedEdge> = {}): PositionedEdge {
  return {
    rel: rel("a", "b"),
    typeName: "Eats",
    fromX: 0,
    fromY: 0,
    toX: 100,
    toY: 0,
    color: "#fff",
    dir: "fwd",
    groupIndex: 0,
    groupTotal: 1,
    ...overrides,
  };
}

describe("layoutGraph", () => {
  it("returns the canvas size and no positions for an empty graph", () => {
    const { positions, width, height } = layoutGraph([], [], new Map());
    expect(positions.size).toBe(0);
    expect(width).toBe(CANVAS_W);
    expect(height).toBe(CANVAS_H);
  });

  it("centres a lone node", () => {
    const { positions } = layoutGraph(["a"], [], new Map());
    expect(positions.get("a")).toEqual({ x: CANVAS_W / 2, y: CANVAS_H / 2 });
  });

  it("is deterministic — no Math.random in the seeding", () => {
    const a = layoutGraph(["a", "b", "c"], [["a", "b"]], new Map());
    const b = layoutGraph(["a", "b", "c"], [["a", "b"]], new Map());
    for (const code of ["a", "b", "c"]) {
      expect(a.positions.get(code)).toEqual(b.positions.get(code));
    }
  });

  it("places every node with finite coordinates and seeds the cache", () => {
    const cache = new Map<string, Pt>();
    const codes = ["a", "b", "c", "d", "e"];
    const { positions } = layoutGraph(codes, [["a", "b"], ["b", "c"]], cache);
    for (const c of codes) {
      const p = positions.get(c)!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(cache.has(c)).toBe(true);
    }
  });

  // The highest-degree node is the visual anchor, so it should land at (or very
  // near) the centre of the virtual canvas.
  it("centres the densest node", () => {
    const codes = ["hub", "a", "b", "c", "d"];
    const edges: Array<[string, string]> = [
      ["hub", "a"],
      ["hub", "b"],
      ["hub", "c"],
      ["hub", "d"],
    ];
    const { positions } = layoutGraph(codes, edges, new Map());
    const hub = positions.get("hub")!;
    expect(hub.x).toBeCloseTo(CANVAS_W / 2, 5);
    expect(hub.y).toBeCloseTo(CANVAS_H / 2, 5);
  });

  it("keeps a mostly-cached layout stable across a filter toggle", () => {
    const cache = new Map<string, Pt>();
    const codes = ["a", "b", "c", "d", "e", "f"];
    const all: Array<[string, string]> = [["a", "b"], ["c", "d"], ["e", "f"]];
    const first = layoutGraph(codes, all, cache);
    const firstPos = new Map([...first.positions].map(([k, v]) => [k, { ...v }]));

    // Toggling one relationship type off drops an edge but keeps the nodes.
    const second = layoutGraph(codes, [["a", "b"], ["c", "d"]], cache);
    for (const c of codes) {
      const d = Math.hypot(
        second.positions.get(c)!.x - firstPos.get(c)!.x,
        second.positions.get(c)!.y - firstPos.get(c)!.y,
      );
      expect(d).toBeLessThan(500);
    }
  });

  it("ignores edges referencing nodes outside the filtered set", () => {
    const { positions } = layoutGraph(["a", "b"], [["a", "gone"]], new Map());
    expect(positions.size).toBe(2);
    expect(Number.isFinite(positions.get("a")!.x)).toBe(true);
  });

  it("keeps disconnected nodes apart", () => {
    const { positions } = layoutGraph(["a", "b", "c"], [], new Map());
    const pts = ["a", "b", "c"].map((c) => positions.get(c)!);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(1);
      }
    }
  });
});

describe("edgeGeometry", () => {
  it("draws a lone edge straight, marked directed", () => {
    const g = edgeGeometry(edge());
    expect(g.pathD).toBe("M 0 0 Q 50 0 100 0");
    expect(g.directed).toBe(true);
    expect(g.textMidX).toBe(50);
    expect(g.textMidY).toBe(0);
    expect(g.angle).toBe(0);
  });

  it("marks an undirected edge as such", () => {
    expect(edgeGeometry(edge({ dir: "u" })).directed).toBe(false);
  });

  it("swaps endpoints for a backwards edge so the arrow points the right way", () => {
    expect(edgeGeometry(edge({ dir: "bwd" })).pathD).toBe("M 100 0 Q 50 0 0 0");
  });

  /**
   * The perpendicular is derived from the pair in canonical (sorted) order.
   * Without that, a->b and b->a in the same bundle would each compute an
   * opposite normal and bow onto the same side of the line, overlapping.
   */
  it("fans opposing edges of the same pair to opposite sides", () => {
    const forward = edgeGeometry(
      edge({ rel: rel("a", "b", 1), groupIndex: 0, groupTotal: 2 }),
    );
    const backward = edgeGeometry(
      edge({
        rel: rel("b", "a", 2),
        fromX: 100,
        fromY: 0,
        toX: 0,
        toY: 0,
        groupIndex: 1,
        groupTotal: 2,
      }),
    );
    expect(Math.sign(forward.textMidY)).toBe(-Math.sign(backward.textMidY));
    expect(forward.textMidY).not.toBe(0);
  });

  it("leaves the middle edge of an odd bundle unbowed", () => {
    expect(edgeGeometry(edge({ groupIndex: 1, groupTotal: 3 })).textMidY).toBe(0);
  });

  it("spreads a bundle symmetrically about the straight line", () => {
    const lo = edgeGeometry(edge({ groupIndex: 0, groupTotal: 2 }));
    const hi = edgeGeometry(edge({ groupIndex: 1, groupTotal: 2 }));
    expect(lo.textMidY).toBeCloseTo(-hi.textMidY);
  });

  it("clamps the label angle so text is never upside-down", () => {
    for (const [toX, toY] of [
      [-100, 0],
      [-100, -100],
      [0, -100],
      [100, 100],
      [-50, 80],
    ]) {
      const { angle } = edgeGeometry(edge({ toX, toY }));
      expect(angle).toBeGreaterThanOrEqual(-90);
      expect(angle).toBeLessThanOrEqual(90);
    }
  });

  it("survives coincident endpoints without producing NaN", () => {
    const g = edgeGeometry(edge({ toX: 0, toY: 0, groupIndex: 0, groupTotal: 2 }));
    expect(g.pathD).not.toContain("NaN");
    expect(Number.isFinite(g.textMidX)).toBe(true);
    expect(Number.isFinite(g.textMidY)).toBe(true);
  });
});
