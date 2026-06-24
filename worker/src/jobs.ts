import type { Env } from "./types";
import { sendReply, downloadFile } from "./telegram";
import { answerQuestion, type Thread } from "./ask";
import { resolveReassessTarget, generateReassessment } from "./analyze";
import { runBatch } from "./batch";
import { arrayBufferToBase64 } from "./github";
import {
  identifyPhoto,
  describeSpecimen,
  PENDING_IDENTIFY_KEY,
  PENDING_IDENTIFY_TTL,
  PENDING_SPECIMEN_KEY,
  PENDING_SPECIMEN_TTL,
  type IdentifyCandidate,
  type PendingIdentify,
  type PendingSpecimen,
} from "./identify";

// /ask and /confirm calls can exceed Cloudflare's per-invocation limits
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
// runOrEnqueue: how long to let an LLM call run on the webhook path before
// falling back to the queue. Sized against the Workers Free ~30s invocation
// lifetime (incl. ctx.waitUntil): 10s for the LLM leaves clear room to
// enqueue and reply if we time out. Subrequest count (50/invocation) isn't
// the bottleneck — /ask uses ~3–8, /identify ~3.
const INLINE_TIMEOUT_MS = 10000;
// Batched commits: a chunk of any size costs ~5 GETs + ~5 PUTs (only the
// dirty manifests) regardless of command count. Image deletions add 2 each.
// 25 leaves headroom for analyze-tick on the same invocation under Free's
// 50-subrequest cap and finishes 54-command runs in 3 ticks.
const CONFIRM_CHUNK_SIZE = 25;

type JobKind = "ask" | "confirm" | "identify" | "describe" | "reassess" | "reassess-gen";

export const PENDING_REASSESS_KEY = (userId: number) => `pending:reassess:${userId}`;
const PENDING_REASSESS_TTL_SECONDS = 3600;

const ASK_DAILY_LIMIT = 100;

// Per-user daily cap shared by every LLM-bound entry point (/ask text, /ask on a
// photo, /resp, /reassess). Returns false once the user is over the cap for the
// day. Best-effort: missing KV disables the limit.
export async function checkAskRateLimit(userId: number, env: Env): Promise<boolean> {
  if (!env.ASK_CACHE) return true;
  const today = new Date().toISOString().slice(0, 10);
  const key = `ratelimit:ask:${userId}:${today}`;
  const raw = await env.ASK_CACHE.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= ASK_DAILY_LIMIT) return false;
  await env.ASK_CACHE.put(key, String(count + 1), { expirationTtl: 86400 });
  return true;
}

/** Resolved /reassess target awaiting /confirm. */
export interface PendingReassess {
  shortCode: string;
  zoneCode: string;
  displayName: string;
  note: string;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  kind: JobKind;
  chatId: number;
  messageId: number;
  userId: number | null;
  // ask
  request?: string;
  model?: string;
  history?: Thread["history"];
  style?: string;
  // confirm
  commands?: string[];
  nextIndex?: number;
  results?: string[];
  // identify
  fileId?: string;
  imgWidth?: number;
  imgHeight?: number;
  prompt?: string;
  postedBy?: string;
  /** When set, runs identify as a refine turn against these prior candidates. */
  priorCandidates?: IdentifyCandidate[];
  /** Prompt history from earlier turns in this identify session (excluding the
   *  current `prompt`). */
  priorPrompts?: string[];
  // reassess-gen
  targetShortCode?: string;
  targetZoneCode?: string;
  note?: string;
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

// Try to run a job inline on the webhook path; if it doesn't finish within
// INLINE_TIMEOUT_MS, enqueue it for the cron drain instead. On inline success
// the reply has already been sent by runJob, so callers should only respond
// when the result is "queued". An inline error also falls back to the queue,
// where MAX_ATTEMPTS retries kick in.
//
// On timeout the in-flight call is abandoned (not awaited): the Worker
// invocation ends when handleUpdate's waitUntil resolves, which terminates the
// outbound fetch. Tokens consumed before that are billed by Gemini — accepted
// cost for keeping this path simple.
export async function runOrEnqueue(env: Env, job: JobRecord): Promise<"inline" | "queued"> {
  const TIMEOUT = Symbol("timeout");
  const work = runJob(env, job).then(
    () => ({ ok: true as const }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timerHandle = setTimeout(() => resolve(TIMEOUT), INLINE_TIMEOUT_MS);
  });

  const winner = await Promise.race([work, timeout]);
  if (timerHandle) clearTimeout(timerHandle);

  if (winner === TIMEOUT) {
    work.catch(() => {}); // suppress unhandled rejection from the abandoned call
    await enqueueJob(env, job);
    return "queued";
  }
  if (!winner.ok) {
    console.log(`[runOrEnqueue] inline failed, falling back to queue: ${String(winner.err)}`);
    await enqueueJob(env, job);
    return "queued";
  }
  return "inline";
}

type RunStatus = "done" | "partial";

async function runJob(env: Env, job: JobRecord): Promise<RunStatus> {
  if (job.kind === "ask") {
    const { reply, thread, proposals } = await answerQuestion(
      job.request ?? "",
      env,
      job.model,
      job.history,
      job.style,
    );

    let body = reply;
    if (proposals.length > 0) {
      if (job.userId !== null && env.ASK_CACHE) {
        const pending = { proposals, createdAt: new Date().toISOString() };
        await env.ASK_CACHE.put(`pending:do:${job.userId}`, JSON.stringify(pending), {
          expirationTtl: PENDING_DO_TTL_SECONDS,
        });
      }
      const lines = [
        "",
        "Proposed commands:",
        proposals.map((x, i) => `  ${i + 1}. ${x.command}\n     ${x.rationale}`).join("\n"),
        "",
        "Reply /confirm to run all, /confirm 1 3 to run a subset, or /cancel to drop.",
      ];
      body = `${reply}\n${lines.join("\n")}`;
    }

    await sendReply(env.TELEGRAM_BOT_TOKEN, job.chatId, job.messageId, body);
    if (job.userId !== null && env.ASK_CACHE) {
      await env.ASK_CACHE.put(`thread:${job.userId}`, JSON.stringify(thread));
    }
    return "done";
  }

  if (job.kind === "identify") {
    const bytes = await downloadFile(job.fileId ?? "", env.TELEGRAM_BOT_TOKEN);
    const prior =
      job.priorCandidates && job.priorCandidates.length >= 0 && job.priorPrompts
        ? { candidates: job.priorCandidates, prompts: job.priorPrompts }
        : null;
    const { body, candidates } = await identifyPhoto(
      env,
      arrayBufferToBase64(bytes),
      job.prompt ?? null,
      prior,
    );
    // Persist the candidates + file_id so /pick can replay the chosen one
    // through the normal ingest path. Only store when there's something to
    // pick; an empty result is informational only.
    if (candidates.length > 0 && job.userId !== null && env.ASK_CACHE) {
      const promptHistory = [...(job.priorPrompts ?? []), job.prompt ?? ""];
      const pending: PendingIdentify = {
        createdAt: new Date().toISOString(),
        fileId: job.fileId ?? "",
        width: job.imgWidth,
        height: job.imgHeight,
        postedBy: job.postedBy ?? "unknown",
        candidates,
        userPrompts: promptHistory,
      };
      await env.ASK_CACHE.put(PENDING_IDENTIFY_KEY(job.userId), JSON.stringify(pending), {
        expirationTtl: PENDING_IDENTIFY_TTL,
      });
    }
    await sendReply(env.TELEGRAM_BOT_TOKEN, job.chatId, job.messageId, body);
    return "done";
  }

  if (job.kind === "describe") {
    const bytes = await downloadFile(job.fileId ?? "", env.TELEGRAM_BOT_TOKEN);
    const { body, proposal } = await describeSpecimen(
      env,
      arrayBufferToBase64(bytes),
      job.prompt ?? "",
      job.priorPrompts ?? null,
    );
    // Persist the proposal + file_id so /confirm can replay the photo through the
    // normal ingest path and /resp can revise it. Only store on a real proposal.
    if (proposal && job.userId !== null && env.ASK_CACHE) {
      const promptHistory = [...(job.priorPrompts ?? []), job.prompt ?? ""];
      const pending: PendingSpecimen = {
        ...proposal,
        createdAt: new Date().toISOString(),
        fileId: job.fileId ?? "",
        width: job.imgWidth,
        height: job.imgHeight,
        postedBy: job.postedBy ?? "unknown",
        userPrompts: promptHistory,
      };
      await env.ASK_CACHE.put(PENDING_SPECIMEN_KEY(job.userId), JSON.stringify(pending), {
        expirationTtl: PENDING_SPECIMEN_TTL,
      });
    }
    await sendReply(env.TELEGRAM_BOT_TOKEN, job.chatId, job.messageId, body);
    return "done";
  }

  if (job.kind === "reassess") {
    // Phase 1: resolve the free-text request to a single specimen+zone + note.
    const resolution = await resolveReassessTarget(env, job.request ?? "");
    if (!resolution.ok) {
      await sendReply(env.TELEGRAM_BOT_TOKEN, job.chatId, job.messageId, resolution.message);
      return "done";
    }
    if (job.userId !== null && env.ASK_CACHE) {
      const pending: PendingReassess = {
        shortCode: resolution.shortCode,
        zoneCode: resolution.zoneCode,
        displayName: resolution.displayName,
        note: resolution.note,
        createdAt: new Date().toISOString(),
      };
      await env.ASK_CACHE.put(PENDING_REASSESS_KEY(job.userId), JSON.stringify(pending), {
        expirationTtl: PENDING_REASSESS_TTL_SECONDS,
      });
    }
    await sendReply(
      env.TELEGRAM_BOT_TOKEN,
      job.chatId,
      job.messageId,
      `Will reassess ${resolution.displayName} (${resolution.shortCode}) in zone ${resolution.zoneCode}.\n\nNote to save:\n${resolution.note}\n\nReply /confirm to regenerate the analysis with this note, or /cancel to drop it.`,
    );
    return "done";
  }

  if (job.kind === "reassess-gen") {
    // Phase 2: grounded regeneration with the saved note.
    const result = await generateReassessment(
      env,
      job.targetShortCode ?? "",
      job.targetZoneCode ?? "",
      job.note ?? "",
    );
    if (job.userId !== null && env.ASK_CACHE) {
      await env.ASK_CACHE.delete(PENDING_REASSESS_KEY(job.userId)).catch(() => {});
    }
    await sendReply(
      env.TELEGRAM_BOT_TOKEN,
      job.chatId,
      job.messageId,
      result.ok
        ? `Reassessed ${job.targetShortCode} in zone ${job.targetZoneCode}: verdict ${result.verdict}. Saved note and updated ai_analysis.json.`
        : `Reassessment failed: ${result.message}`,
    );
    return "done";
  }

  // confirm — batched-execution chunks. Each chunk loads gallery+annotations
  // once, applies commands in memory, then writes only the dirty manifests.
  const commands = job.commands ?? [];
  const results = job.results ?? [];
  const start = job.nextIndex ?? 0;
  const end = Math.min(start + CONFIRM_CHUNK_SIZE, commands.length);
  const chunk = commands.slice(start, end);

  // commitBatchState appends [skip-deploy] itself when the dirty manifests go
  // through the compute-metadata→deploy chain; a relationships-only batch is
  // left without it so it deploys directly.
  const message = `Batch /confirm: ${chunk.length} command(s) (${start + 1}-${end} of ${commands.length})`;
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
    `Ran ${commands.length} command(s):\n${results.join("\n")}`,
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

  // Check the queue before touching the lock — on Free-tier KV (1k writes +
  // 1k deletes/day) the per-minute lock churn alone blew the daily budget.
  const queueRaw = await env.ASK_CACHE.get(QUEUE_KV_KEY);
  if (!queueRaw) return { ranTick: false, reason: "no queue" };
  const ids: string[] = JSON.parse(queueRaw);
  if (ids.length === 0) return { ranTick: false, reason: "queue empty" };

  if (await env.ASK_CACHE.get(LOCK_KV_KEY)) return { ranTick: false, reason: "locked" };
  await env.ASK_CACHE.put(LOCK_KV_KEY, new Date().toISOString(), {
    expirationTtl: LOCK_TTL,
  });

  try {
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
        console.log(`[jobs.tick] ${id} attempt ${job.attempts + 1}/${MAX_ATTEMPTS} failed: ${msg}`);
        job.attempts++;
        if (job.attempts >= MAX_ATTEMPTS) {
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            job.chatId,
            job.messageId,
            `Sorry — your /${job.kind} request failed after ${MAX_ATTEMPTS} attempts: ${msg}`,
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
