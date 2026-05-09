import type { Env } from "./types";
import { sendReply } from "./telegram";
import { answerQuestion, type Thread } from "./ask";
import { proposeActions } from "./do";
import { runBatch } from "./batch";

// /ask, /do and /confirm calls can exceed Cloudflare's per-invocation limits
// (waitUntil wall-time for LLM calls; subrequest count for batch /confirm).
// Enqueue here and let the cron drain the queue across multiple ticks, each
// with a fresh subrequest budget.

const QUEUE_KV_KEY = "jobs:queue";
const JOB_PREFIX = "job:";
const LOCK_KV_KEY = "jobs:lock";
const QUEUE_TTL = 7 * 86400;
// Big enough that two slow LLM calls in one tick complete before the next
// minute-aligned tick can race in. If a tick crashes, recovery takes this long.
const LOCK_TTL = 600;
const JOBS_PER_TICK = 2;
// Initial attempt + 1 retry. After two failures we give up and notify the user.
const MAX_ATTEMPTS = 2;
const PENDING_DO_TTL_SECONDS = 3600;
// Batched commits: a chunk of any size costs ~5 GETs + ~5 PUTs (only the
// dirty manifests) regardless of command count. Image deletions add 2 each.
// 25 leaves headroom for analyze-tick on the same invocation under Free's
// 50-subrequest cap and finishes 54-command runs in 3 ticks.
const CONFIRM_CHUNK_SIZE = 25;

type JobKind = "ask" | "do" | "confirm";

export interface JobRecord {
  id: string;
  kind: JobKind;
  chatId: number;
  messageId: number;
  userId: number | null;
  // ask/do
  request?: string;
  model?: string;
  history?: Thread["history"];
  style?: string;
  // confirm
  commands?: string[];
  nextIndex?: number;
  results?: string[];
  createdAt: string;
  attempts: number;
}

export async function enqueueJob(env: Env, job: JobRecord): Promise<void> {
  if (!env.ASK_CACHE) throw new Error("ASK_CACHE not configured");
  await env.ASK_CACHE.put(`${JOB_PREFIX}${job.id}`, JSON.stringify(job), {
    expirationTtl: QUEUE_TTL,
  });
  const raw = await env.ASK_CACHE.get(QUEUE_KV_KEY);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  if (!ids.includes(job.id)) ids.push(job.id);
  await env.ASK_CACHE.put(QUEUE_KV_KEY, JSON.stringify(ids), {
    expirationTtl: QUEUE_TTL,
  });
}

type RunStatus = "done" | "partial";

async function runJob(env: Env, job: JobRecord): Promise<RunStatus> {
  if (job.kind === "ask") {
    const { reply, thread } = await answerQuestion(
      job.request ?? "",
      env,
      job.model,
      job.history,
      job.style
    );
    await sendReply(env.TELEGRAM_BOT_TOKEN, job.chatId, job.messageId, reply);
    if (job.userId !== null && env.ASK_CACHE) {
      await env.ASK_CACHE.put(`thread:${job.userId}`, JSON.stringify(thread));
    }
    return "done";
  }

  if (job.kind === "do") {
    const { summary, proposals } = await proposeActions(job.request ?? "", env, job.style);
    if (proposals.length === 0) {
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        job.chatId,
        job.messageId,
        `${summary}\n\n(no commands proposed)`
      );
      if (job.userId !== null && env.ASK_CACHE) {
        await env.ASK_CACHE.delete(`pending:do:${job.userId}`).catch(() => {});
      }
      return "done";
    }

    if (job.userId !== null && env.ASK_CACHE) {
      const pending = { proposals, createdAt: new Date().toISOString() };
      await env.ASK_CACHE.put(`pending:do:${job.userId}`, JSON.stringify(pending), {
        expirationTtl: PENDING_DO_TTL_SECONDS,
      });
    }
    const lines = [
      summary,
      "",
      "Proposed commands:",
      proposals
        .map((x, i) => `  ${i + 1}. ${x.command}\n     ${x.rationale}`)
        .join("\n"),
      "",
      "Reply /confirm to run all, /confirm 1 3 to run a subset, or /cancel to drop.",
    ];
    await sendReply(env.TELEGRAM_BOT_TOKEN, job.chatId, job.messageId, lines.join("\n"));
    return "done";
  }

  // confirm — batched-execution chunks. Each chunk loads gallery+annotations
  // once, applies commands in memory, then writes only the dirty manifests.
  const commands = job.commands ?? [];
  const results = job.results ?? [];
  const start = job.nextIndex ?? 0;
  const end = Math.min(start + CONFIRM_CHUNK_SIZE, commands.length);
  const chunk = commands.slice(start, end);

  const message = `Batch /confirm: ${chunk.length} command(s) (${start + 1}-${end} of ${commands.length}) [skip-deploy]`;
  const { results: chunkResults } = await runBatch(env, chunk, message);
  for (let i = 0; i < chunk.length; i++) {
    const r = chunkResults[i];
    const n = start + i + 1;
    results.push(`${n}. ${chunk[i]}\n   ${r.ok ? "OK" : "FAIL"}: ${r.reply.split("\n")[0]}`);
  }
  job.nextIndex = end;
  job.results = results;
  // Reset attempts so a per-chunk retry counter doesn't leak across chunks.
  job.attempts = 0;

  if (end < commands.length) return "partial";

  await sendReply(
    env.TELEGRAM_BOT_TOKEN,
    job.chatId,
    job.messageId,
    `Ran ${commands.length} command(s):\n${results.join("\n")}`
  );
  return "done";
}

export interface JobsTickResult {
  ranTick: boolean;
  reason?: string;
  succeeded?: number;
  failed?: number;
  remaining?: number;
}

export async function processJobsTick(env: Env): Promise<JobsTickResult> {
  if (!env.ASK_CACHE) return { ranTick: false, reason: "no KV" };
  if (await env.ASK_CACHE.get(LOCK_KV_KEY)) return { ranTick: false, reason: "locked" };

  // Acquire lock before reading the queue so a concurrent tick that lost the
  // lock-check race still bails before doing real work most of the time.
  await env.ASK_CACHE.put(LOCK_KV_KEY, new Date().toISOString(), {
    expirationTtl: LOCK_TTL,
  });

  try {
    const queueRaw = await env.ASK_CACHE.get(QUEUE_KV_KEY);
    if (!queueRaw) return { ranTick: false, reason: "no queue" };
    const ids: string[] = JSON.parse(queueRaw);
    if (ids.length === 0) return { ranTick: false, reason: "queue empty" };

    const batch = ids.slice(0, JOBS_PER_TICK);
    const removed = new Set<string>();
    let succeeded = 0;
    let failed = 0;

    for (const id of batch) {
      const recRaw = await env.ASK_CACHE.get(`${JOB_PREFIX}${id}`);
      if (!recRaw) {
        removed.add(id);
        continue;
      }
      const job: JobRecord = JSON.parse(recRaw);
      try {
        const status = await runJob(env, job);
        if (status === "partial") {
          // Save progress; leave id in the queue for the next tick.
          await env.ASK_CACHE.put(`${JOB_PREFIX}${id}`, JSON.stringify(job), {
            expirationTtl: QUEUE_TTL,
          });
          continue;
        }
        removed.add(id);
        await env.ASK_CACHE.delete(`${JOB_PREFIX}${id}`).catch(() => {});
        succeeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        console.log(
          `[jobs.tick] ${id} attempt ${job.attempts + 1}/${MAX_ATTEMPTS} failed: ${msg}`
        );
        job.attempts++;
        if (job.attempts >= MAX_ATTEMPTS) {
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            job.chatId,
            job.messageId,
            `Sorry — your /${job.kind} request failed after ${MAX_ATTEMPTS} attempts: ${msg}`
          ).catch(() => {});
          removed.add(id);
          await env.ASK_CACHE.delete(`${JOB_PREFIX}${id}`).catch(() => {});
          failed++;
        } else {
          await env.ASK_CACHE.put(`${JOB_PREFIX}${id}`, JSON.stringify(job), {
            expirationTtl: QUEUE_TTL,
          });
        }
      }
    }

    const remaining = ids.filter((x) => !removed.has(x));
    await env.ASK_CACHE.put(QUEUE_KV_KEY, JSON.stringify(remaining), {
      expirationTtl: QUEUE_TTL,
    });
    return { ranTick: true, succeeded, failed, remaining: remaining.length };
  } finally {
    await env.ASK_CACHE.delete(LOCK_KV_KEY).catch(() => {});
  }
}
