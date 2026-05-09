import type { Env } from "./types";
import { sendReply } from "./telegram";
import { answerQuestion, type Thread } from "./ask";
import { proposeActions } from "./do";

// /ask and /do calls can run for 1–2 minutes. The fetch handler can't keep
// waitUntil() alive that long, so we enqueue here and let the cron drain the
// queue from a scheduled invocation (which gets a much larger wall budget).

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

type JobKind = "ask" | "do";

export interface JobRecord {
  id: string;
  kind: JobKind;
  chatId: number;
  messageId: number;
  userId: number | null;
  request: string;
  model?: string;
  history?: Thread["history"];
  style?: string;
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

async function runJob(env: Env, job: JobRecord): Promise<void> {
  if (job.kind === "ask") {
    const { reply, thread } = await answerQuestion(
      job.request,
      env,
      job.model,
      job.history,
      job.style
    );
    await sendReply(env.TELEGRAM_BOT_TOKEN, job.chatId, job.messageId, reply);
    if (job.userId !== null && env.ASK_CACHE) {
      await env.ASK_CACHE.put(`thread:${job.userId}`, JSON.stringify(thread));
    }
    return;
  }

  const { summary, proposals } = await proposeActions(job.request, env, job.style);
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
    return;
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
        await runJob(env, job);
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
