import { describe, it, expect } from "bun:test";
import { formatCostReport, type CostBucket } from "../cost";

const bucket = (over: Partial<CostBucket> = {}): CostBucket => ({
  usd: 0,
  prompt: 0,
  cached: 0,
  output: 0,
  cacheCreation: 0,
  cacheStorageTokenHours: 0,
  ...over,
});

describe("formatCostReport", () => {
  it("renders zero-spend buckets with the sub-penny sentinel", () => {
    const out = formatCostReport({
      day: bucket(),
      month: bucket(),
      dayLabel: "2026-05-20",
      monthLabel: "2026-05",
    });
    expect(out).toContain("Estimated Gemini spend (this worker):");
    expect(out).toContain("Today  (2026-05-20): <$0.0001");
    expect(out).toContain("Month  (2026-05): <$0.0001");
    expect(out).toContain("0 in / 0 out");
  });

  it("formats usd, token counts, and the trailing disclaimer", () => {
    const out = formatCostReport({
      day: bucket({ usd: 0.27, prompt: 150_000, output: 5_000 }),
      month: bucket({ usd: 1.5, prompt: 1_200_000, output: 80_000 }),
      dayLabel: "2026-05-20",
      monthLabel: "2026-05",
    });
    expect(out).toContain("Today  (2026-05-20): $0.2700");
    expect(out).toContain("150,000 in / 5,000 out");
    expect(out).toContain("Month  (2026-05): $1.5000");
    expect(out).toContain("1,200,000 in / 80,000 out");
    expect(out).toContain("MODEL_PRICING");
  });

  it("includes a cache-breakdown suffix only when cache fields are non-zero", () => {
    const noCache = formatCostReport({
      day: bucket({ usd: 0.1, prompt: 1000, output: 100 }),
      month: bucket(),
      dayLabel: "d",
      monthLabel: "m",
    });
    expect(noCache).not.toContain("[");

    const withCache = formatCostReport({
      day: bucket({
        usd: 0.1,
        prompt: 10_000,
        cached: 4_000,
        output: 100,
        cacheCreation: 2_000,
        cacheStorageTokenHours: 1500,
      }),
      month: bucket(),
      dayLabel: "d",
      monthLabel: "m",
    });
    expect(withCache).toContain("4,000 cached");
    expect(withCache).toContain("2,000 cache-create");
    expect(withCache).toContain("1,500 cache-tok·h");
  });
});
