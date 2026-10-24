import type { Env } from "./types";
import { estimateCost, formatUsd, type Usage } from "./ask";

// Per-day buckets are kept for ~95 days; per-month buckets for ~13 months.
// Both live in ASK_CACHE.
const DAY_TTL_SECONDS = 95 * 86400;
const MONTH_TTL_SECONDS = 400 * 86400;

export interface CostBucket {
  usd: number;
  prompt: number;
  cached: number;
  output: number;
}

const emptyBucket = (): CostBucket => ({
  usd: 0,
  prompt: 0,
  cached: 0,
  output: 0,
});

const dayKey = (d: Date): string => `cost:day:${d.toISOString().slice(0, 10)}`;
const monthKey = (d: Date): string => `cost:month:${d.toISOString().slice(0, 7)}`;

async function bumpBucket(
  env: Env,
  key: string,
  ttlSeconds: number,
  usdDelta: number,
  usage: Usage,
): Promise<void> {
  const raw = await env.ASK_CACHE.get(key);
  const cur: CostBucket = raw ? JSON.parse(raw) : emptyBucket();
  cur.usd += usdDelta;
  cur.prompt += usage.prompt;
  cur.cached += usage.cached;
  cur.output += usage.output;
  await env.ASK_CACHE.put(key, JSON.stringify(cur), { expirationTtl: ttlSeconds });
}

/** Increment today's and this-month's cost buckets. Silently no-ops if the
 *  model is unpriced (no $ to record). Best-effort: a KV
 *  failure here must not break the Gemini call's own response, so callers
 *  should catch and log. */
export async function recordCost(env: Env, model: string, usage: Usage): Promise<void> {
  const usd = estimateCost(model, usage);
  if (usd === null) return;
  const now = new Date();
  await bumpBucket(env, dayKey(now), DAY_TTL_SECONDS, usd, usage);
  await bumpBucket(env, monthKey(now), MONTH_TTL_SECONDS, usd, usage);
}

export async function readCostTotals(
  env: Env,
): Promise<{ day: CostBucket; month: CostBucket; dayLabel: string; monthLabel: string }> {
  const now = new Date();
  const dayLabel = now.toISOString().slice(0, 10);
  const monthLabel = now.toISOString().slice(0, 7);
  const [d, m] = await Promise.all([
    env.ASK_CACHE.get(dayKey(now)),
    env.ASK_CACHE.get(monthKey(now)),
  ]);
  return {
    day: d ? JSON.parse(d) : emptyBucket(),
    month: m ? JSON.parse(m) : emptyBucket(),
    dayLabel,
    monthLabel,
  };
}

function formatBucket(label: string, b: CostBucket): string {
  const tokens = `${b.prompt.toLocaleString()} in / ${b.output.toLocaleString()} out`;
  const cacheStr = b.cached > 0 ? ` [${b.cached.toLocaleString()} cached]` : "";
  return `  ${label}: ${formatUsd(b.usd)}  (${tokens})${cacheStr}`;
}

export function formatCostReport(totals: {
  day: CostBucket;
  month: CostBucket;
  dayLabel: string;
  monthLabel: string;
}): string {
  return [
    "Estimated Gemini spend (this worker):",
    formatBucket(`Today  (${totals.dayLabel})`, totals.day),
    formatBucket(`Month  (${totals.monthLabel})`, totals.month),
    "",
    "Estimate from token rates in MODEL_PRICING — the GCP invoice is authoritative.",
  ].join("\n");
}
