import type { Env } from "./types";
import { sendReply, downloadFile } from "./telegram";
import { answerQuestion, DEFAULT_MODEL, MODEL_ALIASES, type Thread } from "./ask";
import { resolveReassessTarget, generateReassessment } from "./analyze";
import { runBatch } from "./batch";
import { arrayBufferToBase64, PartialCommitError } from "./github";
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
import { CONFIRM_CHUNK_SIZE } from "./commands/keys";

// /ask and /confirm calls can exceed Cloudflare's per-invocation limits
// (waitUntil wall-time for LLM calls; subrequest count for batch /confirm).
// Those go to the JOBS queue, whose consumer (processJobBatch) runs one job
// per invocation — max_batch_size = 1 in wrangler.toml — so each gets a fresh
// 15-minute wall-time and 50-subrequest budget, and one invocation at a time
// (max_concurrency = 1) so /confirm chunks never race each other's commits.
//
// The message carries the job itself. Queue messages cap at 128 KB, so a job
// that won't fit (a long /resp thread's history) is parked in KV and the
// message carries a pointer to it instead.
//
// Delivery is at-least-once, so every message that reaches a final outcome
// (ran, or the user was told it failed) is marked finished in KV, and a
// redelivery of it is acked without running the job again.

const JOB_PREFIX = "job:";
const DONE_PREFIX = "jobdone:";
// Leaves headroom under the 128 KB message cap for the envelope. Messages are
// sent as JSON (contentType "json"), so this UTF-8 count is what the queue
// stores; the default V8 serialization would store any string holding a
// non-Latin-1 character (an em dash, an emoji) at 2 bytes per character.
const MAX_INLINE_JOB_BYTES = 100_000;
// Outlives the Free plan's fixed 24h queue retention, so a parked job and the
// finished marker both outlast any redelivery of their message.
const JOB_TTL = 2 * 86400;
// KV reads in another location can trail a write by up to ~60s (and a miss is
// cached about as long), so a parked job that isn't visible yet is re-sent
// after this delay, up to MAX_REF_MISSES times, before we give up.
const REF_MISS_DELAY_SECONDS = 90;
const MAX_REF_MISSES = 2;
// Value of a finished marker. A parked job's record is overwritten with it, so
// a duplicate delivery doesn't run the job again or mistake a gone record for
// KV lag.
const DONE = "done";
// Initial attempt + 1 retry; after two thrown failures we give up and notify
// the user. This is the only retry budget: wrangler.toml's max_retries must be
// at least MAX_ATTEMPTS (enforced by jobs.test.ts) so that a job whose attempts
// all died without throwing — CPU/memory limit, eviction — gets one more
// delivery, which only reports the failure.
export const MAX_ATTEMPTS = 2;
const RETRY_DELAY_SECONDS = 30;
const PENDING_DO_TTL_SECONDS = 3600;
// runOrEnqueue: how long to let an LLM call run on the webhook path before
// falling back to the queue. Sized against the ~30s ctx.waitUntil window:
// 10s for the LLM leaves clear room to enqueue and reply if we time out.
// Subrequest count (50/invocation) isn't the bottleneck — /ask uses ~3–8,
// /identify ~3.
const INLINE_TIMEOUT_MS = 10000;

type JobKind = "ask" | "confirm" | "identify" | "describe" | "reassess" | "reassess-gen";

export const PENDING_REASSESS_KEY = (userId: number) => `pending:reassess:${userId}`;
const PENDING_REASSESS_TTL_SECONDS = 3600;

const ASK_DAILY_LIMIT = 100;

// Per-user daily cap shared by every LLM-bound entry point (/ask text, /ask on a
// photo, /resp, /reassess). Returns false once the user is over the cap for the
// day.
export async function checkAskRateLimit(userId: number, env: Env): Promise<boolean> {
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
}

/** Who to tell when a job fails — carried even when the job itself is parked. */
interface JobOwner {
  kind: JobKind;
  chatId: number;
  messageId: number;
}

/** Body of a JOBS queue message: the job itself, or a pointer to it in KV. */
export type JobMessage =
  | { job: JobRecord }
  | (JobOwner & {
      /** KV key suffix; unique per send, so a lagging read misses rather
       *  than returning an earlier copy of the job. */
      ref: string;
      misses?: number;
    });

async function sendJobMessage(env: Env, body: JobMessage, delaySeconds?: number): Promise<void> {
  await env.JOBS.send(body, { contentType: "json", delaySeconds });
}

export async function enqueueJob(env: Env, job: JobRecord): Promise<void> {
  const body = JSON.stringify(job);
  if (new TextEncoder().encode(body).byteLength <= MAX_INLINE_JOB_BYTES) {
    await sendJobMessage(env, { job });
    return;
  }
  const ref = `${job.id}:${crypto.randomUUID()}`;
  await env.ASK_CACHE.put(`${JOB_PREFIX}${ref}`, body, { expirationTtl: JOB_TTL });
  await sendJobMessage(env, {
    ref,
    kind: job.kind,
    chatId: job.chatId,
    messageId: job.messageId,
  });
}

// Try to run a job inline on the webhook path; if it doesn't finish within
// INLINE_TIMEOUT_MS, enqueue it on the JOBS queue instead. On inline success
// the reply has already been sent by runJob, so callers should only respond
// when the result is "queued". An inline error also falls back to the queue,
// where MAX_ATTEMPTS retries kick in.
//
// On timeout the in-flight call is abandoned (not awaited) and keeps running
// until the Worker invocation ends with handleUpdate's waitUntil, which can
// overlap the queued copy. Tokens it consumes are billed by Gemini — accepted
// cost for keeping this path simple — but it can't act on its result: runJob
// claims the job before its first side effect (reply, KV write, commit), and
// the claim fails once the job is abandoned. A job already claimed when the
// timer fires is finished here instead of being queued.
export async function runOrEnqueue(env: Env, job: JobRecord): Promise<"inline" | "queued"> {
  const TIMEOUT = Symbol("timeout");
  const run = { phase: "running" as "running" | "claimed" | "abandoned" };
  const claim = () => {
    if (run.phase === "abandoned") throw new Error("abandoned after the inline timeout");
    run.phase = "claimed";
  };
  const work = runJob(env, job, claim).then(
    () => ({ ok: true as const }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timerHandle = setTimeout(() => resolve(TIMEOUT), INLINE_TIMEOUT_MS);
  });

  let winner = await Promise.race([work, timeout]);
  if (timerHandle) clearTimeout(timerHandle);

  if (winner === TIMEOUT) {
    if (run.phase === "running") {
      run.phase = "abandoned";
      await enqueueJob(env, job);
      return "queued";
    }
    winner = await work;
  }
  if (!winner.ok) {
    console.log(`[runOrEnqueue] inline failed, falling back to queue: ${String(winner.err)}`);
    await enqueueJob(env, job);
    return "queued";
  }
  return "inline";
}

type RunStatus = "done" | "partial";

// `claim` is called before the job's first side effect and throws if the run
// has been abandoned (see runOrEnqueue). Queue runs never abandon.
async function runJob(env: Env, job: JobRecord, claim: () => void = () => {}): Promise<RunStatus> {
  if (job.kind === "ask") {
    const { reply, thread, proposals } = await answerQuestion(
      job.request ?? "",
      env,
      job.model,
      job.history,
      job.style,
    );

    claim();
    let body = reply;
    if (proposals.length > 0) {
      if (job.userId !== null) {
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
    if (job.userId !== null) {
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
    claim();
    // Persist the candidates + file_id so /pick can replay the chosen one
    // through the normal ingest path. Only store when there's something to
    // pick; an empty result is informational only.
    if (candidates.length > 0 && job.userId !== null) {
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
    claim();
    // Persist the proposal + file_id so /confirm can replay the photo through the
    // normal ingest path and /resp can revise it. Only store on a real proposal.
    if (proposal && job.userId !== null) {
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
    claim();
    if (!resolution.ok) {
      await sendReply(env.TELEGRAM_BOT_TOKEN, job.chatId, job.messageId, resolution.message);
      return "done";
    }
    if (job.userId !== null) {
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
      claim,
    );
    claim(); // a result that didn't commit still replies
    if (job.userId !== null) {
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

  if (end < commands.length) return "partial";

  // The chunk is committed: a throw from here on would retry the message and
  // apply it a second time, so a failed summary is only logged.
  await sendReply(
    env.TELEGRAM_BOT_TOKEN,
    job.chatId,
    job.messageId,
    `Ran ${commands.length} command(s):\n${results.join("\n")}`,
  ).catch((err) => {
    console.log(`[jobs] ${job.id} summary reply failed: ${String(err)}`);
  });
  return "done";
}

// Queue consumer: one message per batch in practice (max_batch_size = 1), but
// loop anyway so a config change can't silently drop messages.
export async function processJobBatch(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    await processJobMessage(msg, env);
  }
}

async function notifyFailed(env: Env, owner: JobOwner, reason: string): Promise<void> {
  await sendReply(
    env.TELEGRAM_BOT_TOKEN,
    owner.chatId,
    owner.messageId,
    `Sorry — your /${owner.kind} request failed: ${reason}`,
  ).catch(() => {});
}

// KV key of the message's finished marker. A parked job's own record is
// overwritten with DONE; an inline job gets a marker keyed by its id and, for
// /confirm, the chunk it starts at (each chunk is a separate message).
function finishedKey(body: JobMessage): string {
  return "job" in body
    ? `${DONE_PREFIX}${body.job.id}:${body.job.nextIndex ?? 0}`
    : `${JOB_PREFIX}${body.ref}`;
}

async function markFinished(env: Env, key: string): Promise<void> {
  await env.ASK_CACHE.put(key, DONE, { expirationTtl: JOB_TTL }).catch((err) => {
    console.log(`[jobs] failed to mark ${key} finished: ${String(err)}`);
  });
}

async function processJobMessage(msg: Message<JobMessage>, env: Env): Promise<void> {
  const body = msg.body;
  const owner: JobOwner = "job" in body ? body.job : body;
  // Taken before runJob, which advances a /confirm job's nextIndex.
  const doneKey = finishedKey(body);

  let job: JobRecord;
  if ("job" in body) {
    if ((await env.ASK_CACHE.get(doneKey)) !== null) {
      msg.ack(); // duplicate delivery of a finished job
      return;
    }
    job = body.job;
  } else {
    const raw = await env.ASK_CACHE.get(doneKey);
    if (raw === DONE) {
      msg.ack(); // duplicate delivery of a finished job
      return;
    }
    if (raw === null) {
      // Usually KV lag behind the enqueue in another location. A fresh
      // message (not msg.retry) so the wait doesn't spend the run's attempts.
      const misses = (body.misses ?? 0) + 1;
      if (misses <= MAX_REF_MISSES) {
        await sendJobMessage(env, { ...body, misses }, REF_MISS_DELAY_SECONDS);
      } else {
        console.log(`[jobs] ${body.ref} not found in KV after ${MAX_REF_MISSES} re-sends`);
        await notifyFailed(env, owner, "the queued job could not be loaded.");
      }
      msg.ack();
      return;
    }
    job = JSON.parse(raw);
  }

  // Every earlier delivery died without reaching the catch below (CPU/memory
  // limit, eviction), so the queue redelivered past our retry budget. Report
  // it rather than run the job a third time.
  if (msg.attempts > MAX_ATTEMPTS) {
    await notifyFailed(env, owner, `it was interrupted ${MAX_ATTEMPTS} times.`);
    await markFinished(env, doneKey);
    msg.ack();
    return;
  }

  let status: RunStatus;
  try {
    status = await runJob(env, job);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.log(`[jobs] ${job.id} attempt ${msg.attempts}/${MAX_ATTEMPTS} failed: ${message}`);
    if (err instanceof PartialCommitError) {
      // Part of the chunk is already on main; running it again would apply
      // those commands twice.
      await notifyPartialCommit(env, job, err);
    } else if (msg.attempts < MAX_ATTEMPTS) {
      msg.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      return;
    } else {
      await notifyFailed(env, owner, `${message} (after ${MAX_ATTEMPTS} attempts)`);
    }
    await markFinished(env, doneKey);
    msg.ack();
    return;
  }

  // The job has run (a /confirm chunk is committed), so nothing below may
  // throw or retry the message — that would run it again. It is marked
  // finished first so a redelivery is skipped even if this invocation dies
  // before the ack.
  await markFinished(env, doneKey);
  if (status === "partial") {
    // Hand the next /confirm chunk to a fresh invocation (and so a fresh
    // subrequest budget).
    try {
      await enqueueJob(env, job);
    } catch (err) {
      console.log(`[jobs] ${job.id} failed to queue next chunk: ${String(err)}`);
      const total = job.commands?.length ?? 0;
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        job.chatId,
        job.messageId,
        `Ran ${job.nextIndex} of ${total} command(s), then couldn't queue the rest — commands ${(job.nextIndex ?? 0) + 1}-${total} were NOT run.\n${(job.results ?? []).join("\n")}`,
      ).catch(() => {});
    }
  }
  msg.ack();
}

async function notifyPartialCommit(
  env: Env,
  job: JobRecord,
  err: PartialCommitError,
): Promise<void> {
  const total = job.commands?.length ?? 0;
  const start = job.nextIndex ?? 0;
  const end = Math.min(start + CONFIRM_CHUNK_SIZE, total);
  const notRun = end < total ? ` Commands ${end + 1}-${total} were NOT run.` : "";
  const earlier = job.results?.length ? `\n${job.results.join("\n")}` : "";
  await sendReply(
    env.TELEGRAM_BOT_TOKEN,
    job.chatId,
    job.messageId,
    `Commands ${start + 1}-${end} were only partly saved (${err.message}). Not retried, so nothing is applied twice — check those changes before re-running them.${notRun}${earlier}`,
  ).catch(() => {});
}

// One-time drain of the KV list the cron-based job runner used ("jobs:queue"
// holding ids of "job:<id>" records), so jobs queued before the switch to the
// JOBS queue still run. Remove it after the first deploy of the queue-based
// runner has drained the list; until then a warm isolate stops checking once
// it has seen the list gone.
const LEGACY_QUEUE_KEY = "jobs:queue";
const LEGACY_LOCK_KEY = "jobs:lock";
let legacyQueueDrained = false;

export async function drainLegacyJobQueue(env: Env): Promise<number> {
  if (legacyQueueDrained) return 0;
  const raw = await env.ASK_CACHE.get(LEGACY_QUEUE_KEY);
  if (!raw) {
    legacyQueueDrained = true;
    return 0;
  }
  let ids: string[];
  try {
    ids = JSON.parse(raw);
  } catch {
    console.log(`[jobs.legacy] dropping unparseable ${LEGACY_QUEUE_KEY}`);
    await env.ASK_CACHE.delete(LEGACY_QUEUE_KEY);
    return 0;
  }

  let moved = 0;
  const retry: string[] = [];
  for (const id of ids) {
    const key = `${JOB_PREFIX}${id}`;
    let job: JobRecord;
    try {
      const recRaw = await env.ASK_CACHE.get(key);
      if (!recRaw) continue;
      const { attempts: _attempts, ...rec } = JSON.parse(recRaw) as JobRecord & {
        attempts?: number;
      };
      job = rec;
    } catch (err) {
      // A record that won't load can't be retried into shape; drop it so it
      // doesn't block the rest of the list.
      console.log(`[jobs.legacy] dropping unreadable ${key}: ${String(err)}`);
      await env.ASK_CACHE.delete(key).catch(() => {});
      continue;
    }
    // The record may name a model retired since it was queued.
    if (job.kind === "ask" && job.model && !Object.values(MODEL_ALIASES).includes(job.model)) {
      job.model = DEFAULT_MODEL;
    }
    try {
      await enqueueJob(env, job);
    } catch (err) {
      console.log(`[jobs.legacy] failed to move ${key}, will retry: ${String(err)}`);
      retry.push(id);
      continue;
    }
    await env.ASK_CACHE.delete(key).catch(() => {});
    moved++;
  }

  if (retry.length > 0) {
    await env.ASK_CACHE.put(LEGACY_QUEUE_KEY, JSON.stringify(retry), {
      expirationTtl: JOB_TTL,
    });
  } else {
    await env.ASK_CACHE.delete(LEGACY_QUEUE_KEY);
    await env.ASK_CACHE.delete(LEGACY_LOCK_KEY).catch(() => {});
    legacyQueueDrained = true;
  }
  return moved;
}
