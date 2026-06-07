import { describe, it, expect } from "bun:test";
import {
  computeMonthMarkers,
  cosineDistance,
  hammingDistanceHex,
  paletteDistance,
  sortOrganisms,
} from "../utils/sorting";
import { organism } from "./helpers";

describe("cosineDistance", () => {
  it("returns 0 for identical unit vectors", () => {
    expect(cosineDistance([1, 0, 0], [1, 0, 0])).toBeCloseTo(0);
  });

  it("returns 1 for orthogonal unit vectors", () => {
    expect(cosineDistance([1, 0, 0], [0, 1, 0])).toBeCloseTo(1);
  });

  it("returns 2 for opposite unit vectors", () => {
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2);
  });

  it("returns 0 for any identical pre-normalized embedding", () => {
    const v = [0.6, 0.8];
    expect(cosineDistance(v, v)).toBeCloseTo(0);
  });

  it("handles zero vectors without throwing", () => {
    expect(() => cosineDistance([0, 0], [0, 0])).not.toThrow();
  });
});

describe("hammingDistanceHex", () => {
  it("returns 0 for identical strings", () => {
    expect(hammingDistanceHex("abcd", "abcd")).toBe(0);
  });

  it("counts differing bits for a single hex digit: '0' vs 'f' = 4 bits", () => {
    expect(hammingDistanceHex("0", "f")).toBe(4);
  });

  it("pads shorter string with '0' when lengths differ", () => {
    // "f" vs "" → "f" vs "0" → 4 bits
    expect(hammingDistanceHex("f", "")).toBe(4);
  });

  it("sums bit differences across all positions", () => {
    // "0000" vs "ffff" = 4 × 4 bits = 16
    expect(hammingDistanceHex("0000", "ffff")).toBe(16);
  });

  it("handles typical phash length strings", () => {
    expect(hammingDistanceHex("abcdef12", "abcdef12")).toBe(0);
    expect(typeof hammingDistanceHex("abcdef12", "12345678")).toBe("number");
  });
});

describe("paletteDistance", () => {
  it("returns Infinity when first argument is null", () => {
    expect(paletteDistance(null, [[0, 0, 0]])).toBe(Infinity);
  });

  it("returns Infinity when second argument is null", () => {
    expect(paletteDistance([[0, 0, 0]], null)).toBe(Infinity);
  });

  it("returns Infinity when either array is empty", () => {
    expect(paletteDistance([], [[0, 0, 0]])).toBe(Infinity);
    expect(paletteDistance([[0, 0, 0]], [])).toBe(Infinity);
  });

  it("returns 0 for identical single-color palettes", () => {
    expect(paletteDistance([[50, 10, 20]], [[50, 10, 20]])).toBe(0);
  });

  it("returns 0 for identical multi-color palettes", () => {
    const p = [
      [0, 0, 0],
      [100, 50, 25],
    ];
    expect(paletteDistance(p, p)).toBe(0);
  });

  it("averages CIELAB distances across the shorter palette", () => {
    // Only first entry compared; lab distance = sqrt(0²+3²+4²) = 5
    const a = [
      [0, 3, 4],
      [100, 0, 0],
    ];
    const b = [[0, 0, 0]];
    expect(paletteDistance(a, b)).toBeCloseTo(5);
  });
});

describe("sortOrganisms", () => {
  const p1 = organism({ id: "p1", addedAt: "2024-01-01T00:00:00Z" });
  const p2 = organism({ id: "p2", addedAt: "2024-03-15T00:00:00Z" });
  const p3 = organism({ id: "p3", addedAt: "2023-06-01T00:00:00Z" });

  it("sorts newest first", () => {
    const sorted = sortOrganisms([p1, p2, p3], "newest");
    expect(sorted.map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
  });

  it("sorts oldest first", () => {
    const sorted = sortOrganisms([p1, p2, p3], "oldest");
    expect(sorted.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
  });

  it("does not mutate the input array", () => {
    const input = [p1, p2, p3];
    const origIds = input.map((p) => p.id);
    sortOrganisms(input, "newest");
    expect(input.map((p) => p.id)).toEqual(origIds);
  });

  it("handles a single-element array", () => {
    expect(sortOrganisms([p1], "newest")).toEqual([p1]);
  });

  it("handles an empty array", () => {
    expect(sortOrganisms([], "newest")).toEqual([]);
  });
});

describe("computeMonthMarkers", () => {
  // Mid-month dates avoid timezone month-boundary flakiness.
  const inMonth = (id: string, iso: string) => organism({ id, addedAt: iso });

  it("returns no markers for non-newest/oldest modes", () => {
    const list = [
      inMonth("a", "2026-06-15T12:00:00Z"),
      inMonth("b", "2026-05-15T12:00:00Z"),
    ];
    expect(computeMonthMarkers(list, "color").size).toBe(0);
    expect(computeMonthMarkers(list, "similarity").size).toBe(0);
  });

  it("always marks the newest month even with a single pic", () => {
    const list = [
      inMonth("new", "2026-06-15T12:00:00Z"), // newest, 1 pic
      inMonth("old1", "2026-03-15T12:00:00Z"),
      inMonth("old2", "2026-03-16T12:00:00Z"),
    ];
    const markers = computeMonthMarkers(list, "newest");
    expect(markers.get("new")).toBe("June 2026");
    // March has only 2 pics and isn't newest → no header
    expect(markers.has("old1")).toBe(false);
  });

  it("marks an older month once it has at least three pics", () => {
    const list = [
      inMonth("new", "2026-06-15T12:00:00Z"),
      inMonth("m1", "2026-03-15T12:00:00Z"),
      inMonth("m2", "2026-03-16T12:00:00Z"),
      inMonth("m3", "2026-03-17T12:00:00Z"),
    ];
    const markers = computeMonthMarkers(list, "newest");
    expect(markers.get("new")).toBe("June 2026");
    expect(markers.get("m1")).toBe("March 2026"); // first of the qualifying run
    expect(markers.has("m2")).toBe(false);
    expect(markers.has("m3")).toBe(false);
  });

  it("places the marker on the first organism of the month in the given order", () => {
    // oldest-sort order: March group first, then June
    const list = [
      inMonth("m1", "2026-03-15T12:00:00Z"),
      inMonth("m2", "2026-03-16T12:00:00Z"),
      inMonth("m3", "2026-03-17T12:00:00Z"),
      inMonth("new", "2026-06-15T12:00:00Z"),
    ];
    const markers = computeMonthMarkers(list, "oldest");
    expect(markers.get("m1")).toBe("March 2026");
    expect(markers.get("new")).toBe("June 2026");
  });

  it("derives the month from the image timestamp in the id, not addedAt", () => {
    // id ts = 2026-06-15 ~ UTC; addedAt is a different month
    const ts = Math.floor(Date.UTC(2026, 5, 15, 12) / 1000);
    const o = organism({ id: `A atr-${ts}`, addedAt: "2026-01-01T00:00:00Z" });
    const markers = computeMonthMarkers([o], "newest");
    expect(markers.get(o.id)).toBe("June 2026");
  });
});
