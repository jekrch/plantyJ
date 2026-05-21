import { describe, it, expect } from "bun:test";
import { estimateCost, formatUsd, type Usage } from "../ask";

const u = (over: Partial<Usage> = {}): Usage => ({
  prompt: 0,
  cached: 0,
  output: 0,
  cacheCreation: 0,
  cacheStorageTokenHours: 0,
  ...over,
});

describe("estimateCost", () => {
  it("returns null for unpriced models", () => {
    expect(estimateCost("not-a-real-model", u({ prompt: 1000 }))).toBeNull();
  });

  it("returns 0 when usage is all zero", () => {
    expect(estimateCost("gemini-2.5-pro", u())).toBe(0);
  });

  it("prices uncached input at the low tier when prompt <= 200k", () => {
    // gemini-2.5-pro tier 0 input = $1.25/M.
    // 100k tokens at $1.25/M = $0.125.
    expect(estimateCost("gemini-2.5-pro", u({ prompt: 100_000 }))).toBeCloseTo(0.125, 6);
  });

  it("prices uncached input at the high tier when prompt > 200k", () => {
    // gemini-2.5-pro tier 1 input = $2.50/M.
    // 300k tokens at $2.50/M = $0.75.
    expect(estimateCost("gemini-2.5-pro", u({ prompt: 300_000 }))).toBeCloseTo(0.75, 6);
  });

  it("subtracts cached tokens from uncached and prices them at the cached rate", () => {
    // 100k prompt total, 20k cached → 80k uncached. Tier 0.
    // 80k * 1.25 + 20k * 0.31 = 100,000 + 6,200 = 106,200, /1M → 0.1062
    const cost = estimateCost("gemini-2.5-pro", u({ prompt: 100_000, cached: 20_000 }));
    expect(cost).toBeCloseTo(0.1062, 6);
  });

  it("prices output and cache creation together", () => {
    // gemini-3.1-flash-lite-preview flat-rate: i=0.1, c=0.025, o=0.4, s=1.0
    // 1M output at $0.40/M = $0.40 exactly.
    expect(estimateCost("gemini-3.1-flash-lite-preview", u({ output: 1_000_000 }))).toBeCloseTo(
      0.4,
      6,
    );
    // cacheCreation is metered as input → 1M cacheCreation at $0.10/M = $0.10.
    expect(
      estimateCost("gemini-3.1-flash-lite-preview", u({ cacheCreation: 1_000_000 })),
    ).toBeCloseTo(0.1, 6);
  });

  it("prices cache storage by token-hours at the flat 's' rate", () => {
    // gemini-3.1-flash-lite-preview: s=1.0 USD/Mtok-h.
    expect(
      estimateCost("gemini-3.1-flash-lite-preview", u({ cacheStorageTokenHours: 1_000_000 })),
    ).toBeCloseTo(1.0, 6);
  });

  it("sums all usage components in a realistic call", () => {
    // gemini-3.1-pro-preview tier 0: i=2.0, c=0.2, o=12.0, s=4.5
    // 100k uncached input: 100k*2 = 200,000
    // 50k cached input:    50k*0.2 = 10,000
    // 5k  output:          5k*12   = 60,000
    // sum = 270,000; /1M = 0.27
    const cost = estimateCost(
      "gemini-3.1-pro-preview",
      u({ prompt: 150_000, cached: 50_000, output: 5_000 }),
    );
    expect(cost).toBeCloseTo(0.27, 6);
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
