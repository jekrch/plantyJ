import { describe, it, expect } from "bun:test";
import { resolveNeighbors } from "../adjacency";
import type { Plant } from "../types";
import { plant } from "./helpers";

const PANEL_H = 100;
const getHeight = (_: Plant, _w: number) => PANEL_H;

// Filler items need a 'key' property which the internal code reads via (f as any).key
type AnyItem = any;

describe("resolveNeighbors", () => {
  it("detects a panel directly above the filler (top neighbor)", () => {
    const p = plant({ id: "p1" });
    const items: AnyItem[] = [
      { kind: "panel", x: 0, y: 0, w: 100, h: 0, panel: p },
      // filler top edge at y=100 = panel bottom edge (0 + getHeight=100)
      { kind: "filler", key: "f1", x: 0, y: 100, w: 100, h: 50 },
    ];
    const result = resolveNeighbors(items, getHeight);
    expect(result.get("f1")?.top).toBe(p);
  });

  it("detects a panel directly below the filler (bottom neighbor)", () => {
    const p = plant({ id: "p1" });
    const items: AnyItem[] = [
      { kind: "panel", x: 0, y: 50, w: 100, h: 0, panel: p },
      // filler bottom edge at y=50 = panel top edge
      { kind: "filler", key: "f1", x: 0, y: 0, w: 100, h: 50 },
    ];
    const result = resolveNeighbors(items, getHeight);
    expect(result.get("f1")?.bottom).toBe(p);
  });

  it("detects a panel to the left of the filler", () => {
    const p = plant({ id: "p1" });
    const items: AnyItem[] = [
      { kind: "panel", x: 0, y: 0, w: 100, h: 0, panel: p },
      // filler left edge at x=100 = panel right edge
      { kind: "filler", key: "f1", x: 100, y: 0, w: 50, h: 100 },
    ];
    const result = resolveNeighbors(items, getHeight);
    expect(result.get("f1")?.left).toBe(p);
  });

  it("detects a panel to the right of the filler", () => {
    const p = plant({ id: "p1" });
    const items: AnyItem[] = [
      { kind: "panel", x: 150, y: 0, w: 100, h: 0, panel: p },
      // filler right edge at x=150 = panel left edge
      { kind: "filler", key: "f1", x: 0, y: 0, w: 150, h: 100 },
    ];
    const result = resolveNeighbors(items, getHeight);
    expect(result.get("f1")?.right).toBe(p);
  });

  it("returns an empty neighbor map when no panels are adjacent", () => {
    const p = plant({ id: "p1" });
    const items: AnyItem[] = [
      { kind: "panel", x: 500, y: 500, w: 100, h: 0, panel: p },
      { kind: "filler", key: "f1", x: 0, y: 0, w: 100, h: 100 },
    ];
    const result = resolveNeighbors(items, getHeight);
    expect(result.get("f1")).toEqual({});
  });

  it("creates an entry for every filler, even ones with no neighbors", () => {
    const p = plant({ id: "p1" });
    const items: AnyItem[] = [
      { kind: "panel", x: 0, y: 0, w: 100, h: 0, panel: p },
      { kind: "filler", key: "f1", x: 0, y: 100, w: 100, h: 50 },
      { kind: "filler", key: "f2", x: 800, y: 800, w: 50, h: 50 },
    ];
    const result = resolveNeighbors(items, getHeight);
    expect(result.has("f1")).toBe(true);
    expect(result.has("f2")).toBe(true);
  });

  it("does not match a panel whose horizontal span does not overlap the filler", () => {
    // Panel is entirely to the right of the filler's column — no horizontal overlap
    const p = plant({ id: "p1" });
    const items: AnyItem[] = [
      { kind: "panel", x: 200, y: 0, w: 100, h: 0, panel: p },
      { kind: "filler", key: "f1", x: 0, y: 100, w: 50, h: 50 },
    ];
    const result = resolveNeighbors(items, getHeight);
    expect(result.get("f1")?.top).toBeUndefined();
  });

  it("returns an empty map when there are no fillers", () => {
    const p = plant({ id: "p1" });
    const items: AnyItem[] = [
      { kind: "panel", x: 0, y: 0, w: 100, h: 0, panel: p },
    ];
    const result = resolveNeighbors(items, getHeight);
    expect(result.size).toBe(0);
  });

  it("uses getPlantHeight to determine panel bottom edge", () => {
    const p = plant({ id: "p1" });
    // Panel has h=0 in the item, but getHeight returns 200
    const tallHeight = (_: Plant, _w: number) => 200;
    const items: AnyItem[] = [
      { kind: "panel", x: 0, y: 0, w: 100, h: 0, panel: p },
      { kind: "filler", key: "f1", x: 0, y: 200, w: 100, h: 50 },
    ];
    const result = resolveNeighbors(items, tallHeight);
    expect(result.get("f1")?.top).toBe(p);
  });
});
