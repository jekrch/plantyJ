import { describe, it, expect } from "bun:test";
import { estimateCost, formatUsd, type Usage } from "../ask";

const u = (over: Partial<Usage> = {}): Usage => ({
  prompt: 0,
  cached: 0,
  output: 0,
  ...over,
});

const NOV = new Date("2026-11-15T12:00:00Z");

describe("estimateCost", () => {
  it("returns null for unpriced models", () => {
    expect(estimateCost("not-a-real-model", u({ prompt: 1000 }))).toBeNull();
  });

  it("returns 0 when usage is all zero", () => {
    expect(estimateCost("gemini-4-argon", u(), NOV)).toBe(0);
  });

  it("prices uncached input at the input rate", () => {
    // gemini-4-argon (Nov 2026) input = $2.00/M.
    // 100k tokens at $2.00/M = $0.20.
    expect(estimateCost("gemini-4-argon", u({ prompt: 100_000 }), NOV)).toBeCloseTo(0.2, 6);
  });

  it("subtracts cached tokens from uncached and prices them at the cached rate", () => {
    // 100k prompt total, 20k cached → 80k uncached.
    // 80k * 2.0 + 20k * 0.1 = 160,000 + 2,000 = 162,000, /1M → 0.162
    const cost = estimateCost("gemini-4-argon", u({ prompt: 100_000, cached: 20_000 }), NOV);
    expect(cost).toBeCloseTo(0.162, 6);
  });

  it("prices output at the output rate", () => {
    // gemini-3.5-flash-lite: o=2.5. 1M output at $2.50/M = $2.50 exactly.
    expect(estimateCost("gemini-3.5-flash-lite", u({ output: 1_000_000 }))).toBeCloseTo(2.5, 6);
  });

  it("switches to a later price period on its effective date", () => {
    // gemini-3.8-flash input: $0.75/M through 2026-12-31, $1.50/M from 2027-01-01.
    const usage = u({ prompt: 1_000_000 });
    expect(estimateCost("gemini-3.8-flash", usage, new Date("2026-12-31T23:59:59Z"))).toBeCloseTo(
      0.75,
      6,
    );
    expect(estimateCost("gemini-3.8-flash", usage, new Date("2027-01-01T00:00:00Z"))).toBeCloseTo(
      1.5,
      6,
    );
  });

  it("sums all usage components in a realistic call", () => {
    // gemini-4-argon from 2026-12-01: i=4.0, c=0.2, o=20.0
    // 100k uncached input: 100k*4   = 400,000
    // 50k cached input:    50k*0.2  = 10,000
    // 5k  output:          5k*20    = 100,000
    // sum = 510,000; /1M = 0.51
    const cost = estimateCost(
      "gemini-4-argon",
      u({ prompt: 150_000, cached: 50_000, output: 5_000 }),
      new Date("2026-12-01T00:00:00Z"),
    );
    expect(cost).toBeCloseTo(0.51, 6);
  });
});

describe("formatUsd", () => {
  it("collapses sub-penny values to a fixed sentinel", () => {
    expect(formatUsd(0)).toBe("<$0.0001");
    expect(formatUsd(0.00005)).toBe("<$0.0001");
  });

  it("formats with 4 decimal places at and above the threshold", () => {
    expect(formatUsd(0.0001)).toBe("$0.0001");
    expect(formatUsd(0.27)).toBe("$0.2700");
    expect(formatUsd(12.345678)).toBe("$12.3457");
  });
});
