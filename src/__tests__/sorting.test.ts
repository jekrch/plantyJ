import { describe, it, expect } from "bun:test";
import { cosineDistance, hammingDistanceHex, paletteDistance, sortPlants } from "../utils/sorting";
import { plant } from "./helpers";

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
    const p = [[0, 0, 0], [100, 50, 25]];
    expect(paletteDistance(p, p)).toBe(0);
  });

  it("averages CIELAB distances across the shorter palette", () => {
    // Only first entry compared; lab distance = sqrt(0²+3²+4²) = 5
    const a = [[0, 3, 4], [100, 0, 0]];
    const b = [[0, 0, 0]];
    expect(paletteDistance(a, b)).toBeCloseTo(5);
  });
});

describe("sortPlants", () => {
  const p1 = plant({ id: "p1", addedAt: "2024-01-01T00:00:00Z" });
  const p2 = plant({ id: "p2", addedAt: "2024-03-15T00:00:00Z" });
  const p3 = plant({ id: "p3", addedAt: "2023-06-01T00:00:00Z" });

  it("sorts newest first", () => {
    const sorted = sortPlants([p1, p2, p3], "newest");
    expect(sorted.map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
  });

  it("sorts oldest first", () => {
    const sorted = sortPlants([p1, p2, p3], "oldest");
    expect(sorted.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
  });

  it("does not mutate the input array", () => {
    const input = [p1, p2, p3];
    const origIds = input.map((p) => p.id);
    sortPlants(input, "newest");
    expect(input.map((p) => p.id)).toEqual(origIds);
  });

  it("handles a single-element array", () => {
    expect(sortPlants([p1], "newest")).toEqual([p1]);
  });

  it("handles an empty array", () => {
    expect(sortPlants([], "newest")).toEqual([]);
  });
});
