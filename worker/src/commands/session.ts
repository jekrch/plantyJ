// Handlers for conversational / stateful commands: style prefs, the pending
// proposal + specimen + identify flows, and the LLM-backed runs. Everything
// here reads or clears per-user state in KV.
import type { Env, TelegramMessage, TelegramPhotoSize } from "../types";
import { type Replier } from "../telegram";
import { MODEL_ALIASES, type Thread } from "../ask";
import { ingestPlantPhoto } from "../photos";
import {
  PENDING_IDENTIFY_KEY,
  PENDING_SPECIMEN_KEY,
  type PendingIdentify,
  type PendingSpecimen,
} from "../identify";
import { submitAnalyzeRun, analyzeStatus, clearAnalyzeRun, formatAnalyzeUsage } from "../analyze";
import {
  enqueueJob,
  runOrEnqueue,
  checkAskRateLimit,
  PENDING_REASSESS_KEY,
  type PendingReassess,
} from "../jobs";
import { readCostTotals, formatCostReport } from "../cost";
import {
  CONFIRM_BATCH_RATE_PER_MIN,
  PENDING_DO_KEY,
  STYLE_KEY,
  THREAD_KEY,
  type PendingDo,
} from "./keys";
import { parseConfirmIndices } from "./parse";

export async function handleAskStyle(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier,
): Promise<void> {
  const styleText = text.match(/^\/askstyle(?:\s+(\S[\s\S]*))?$/i)![1]?.trim();
  if (!message.from || !env.ASK_CACHE) {
    await reply("Style preferences require user context.");
    return;
  }
  if (styleText) {
    await env.ASK_CACHE.put(STYLE_KEY(message.from.id), styleText);
    await reply(`Style set: ${styleText}`);
  } else {
    await env.ASK_CACHE.delete(STYLE_KEY(message.from.id));
    await reply("Style cleared.");
  }
}

export async function handleShowStyle(message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  const style =
    message.from && env.ASK_CACHE ? await env.ASK_CACHE.get(STYLE_KEY(message.from.id)) : null;
  await reply(
    style ? `Current style: ${style}` : "No style set. Use /askstyle {description} to set one.",
  );
}

export async function handleCancel(message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  if (message.from && env.ASK_CACHE) {
    await Promise.all([
      env.ASK_CACHE.delete(PENDING_DO_KEY(message.from.id)).catch(() => {}),
      env.ASK_CACHE.delete(PENDING_IDENTIFY_KEY(message.from.id)).catch(() => {}),
      env.ASK_CACHE.delete(PENDING_SPECIMEN_KEY(message.from.id)).catch(() => {}),
      env.ASK_CACHE.delete(PENDING_REASSESS_KEY(message.from.id)).catch(() => {}),
    ]);
  }
  await reply(
    "Cancelled. Nothing run; any pending proposals, identify options, specimen, or reassessment dropped.",
  );
}

export async function handlePick(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier,
): Promise<void> {
  if (!message.from || !env.ASK_CACHE) {
    await reply("/pick requires KV and a known user.");
    return;
  }
  const raw = await env.ASK_CACHE.get(PENDING_IDENTIFY_KEY(message.from.id));
  if (!raw) {
    await reply("Nothing to pick. Post a photo with /identify first.");
    return;
  }
  const pending: PendingIdentify = JSON.parse(raw);
  const n = parseInt(text.match(/^\/pick\s+(\d+)$/)![1], 10);
  if (n < 1 || n > pending.candidates.length) {
    await reply(`Invalid option. Use /pick 1..${pending.candidates.length}, or /cancel.`);
    return;
  }
  const candidate = pending.candidates[n - 1];
  // Replay the stored photo through the exact normal-upload path. file_id is
  // stable for the bot, so re-downloading it later still works.
  const photo: TelegramPhotoSize = {
    file_id: pending.fileId,
    file_unique_id: "",
    width: pending.width ?? 0,
    height: pending.height ?? 0,
  };
  const result = await ingestPlantPhoto(env, candidate.caption, photo, pending.postedBy);
  // Drop the pending options only after a successful commit so a failure
  // (bad zone, GitHub conflict) leaves the other options pickable.
  await env.ASK_CACHE.delete(PENDING_IDENTIFY_KEY(message.from.id)).catch(() => {});
  await reply(`Picked option ${n}: ${candidate.label}\n\n${result}`);
}

export async function handleConfirm(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier,
): Promise<void> {
  if (!message.from || !env.ASK_CACHE) {
    await reply("/confirm requires KV and a known user.");
    return;
  }
  // A pending specimen (from /ask on a photo) is the most recent deliberate
  // action, so it takes precedence over an older proposal list or reassessment.
  const specimenRaw = await env.ASK_CACHE.get(PENDING_SPECIMEN_KEY(message.from.id));
  if (specimenRaw) {
    const pending: PendingSpecimen = JSON.parse(specimenRaw);
    // Replay the stored photo through the exact normal-upload path, just like /pick.
    const photo: TelegramPhotoSize = {
      file_id: pending.fileId,
      file_unique_id: "",
      width: pending.width ?? 0,
      height: pending.height ?? 0,
    };
    const result = await ingestPlantPhoto(env, pending.caption, photo, pending.postedBy);
    // Drop the pending entry only after a successful commit so a failure (bad
    // zone, GitHub conflict) leaves it intact to retry or /resp.
    await env.ASK_CACHE.delete(PENDING_SPECIMEN_KEY(message.from.id)).catch(() => {});
    await reply(result);
    return;
  }
  const raw = await env.ASK_CACHE.get(PENDING_DO_KEY(message.from.id));
  if (!raw) {
    // No pending proposals — a bare /confirm may instead be confirming a
    // resolved /reassess target.
    const reassessRaw = await env.ASK_CACHE.get(PENDING_REASSESS_KEY(message.from.id));
    if (reassessRaw) {
      const pendingReassess: PendingReassess = JSON.parse(reassessRaw);
      const status = await runOrEnqueue(env, {
        id: `reassess-gen-${message.from.id}-${message.message_id}`,
        kind: "reassess-gen",
        chatId: message.chat.id,
        messageId: message.message_id,
        userId: message.from.id,
        targetShortCode: pendingReassess.shortCode,
        targetZoneCode: pendingReassess.zoneCode,
        note: pendingReassess.note,
        createdAt: new Date().toISOString(),
        attempts: 0,
      });
      if (status === "queued") {
        await reply(
          `Regenerating the analysis for ${pendingReassess.displayName} (${pendingReassess.shortCode}) in zone ${pendingReassess.zoneCode} — queued, reply will arrive shortly.`,
        );
      }
      return;
    }
    await reply("Nothing to confirm. Start with /ask {request} or /reassess {description}.");
    return;
  }
  const pending: PendingDo = JSON.parse(raw);
  const sel = parseConfirmIndices(text, pending.proposals.length);
  if (sel === "invalid") {
    await reply(
      `Invalid selection. Use /confirm (all) or /confirm N [N ...] with numbers 1..${pending.proposals.length}.`,
    );
    return;
  }
  const indices = sel === "all" ? pending.proposals.map((_, i) => i + 1) : sel;
  const commands = indices.map((n) => pending.proposals[n - 1].command);
  await enqueueJob(env, {
    id: `confirm-${message.from.id}-${message.message_id}`,
    kind: "confirm",
    chatId: message.chat.id,
    messageId: message.message_id,
    userId: message.from.id,
    commands,
    nextIndex: 0,
    results: [],
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  await env.ASK_CACHE.delete(PENDING_DO_KEY(message.from.id)).catch(() => {});
  const etaMin = Math.ceil(commands.length / CONFIRM_BATCH_RATE_PER_MIN);
  await reply(
    `Queued ${commands.length} command(s) — batched in chunks of ${CONFIRM_BATCH_RATE_PER_MIN}/min (~${etaMin} min). Summary will arrive when complete.`,
  );
}

export async function handleAsk(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier,
): Promise<void> {
  const m = text.match(/^\/ask([123])?\s+(\S[\s\S]*)$/i)!;
  const alias = m[1] ?? "3";
  const question = m[2].trim();
  const model = MODEL_ALIASES[alias];
  if (!env.ASK_CACHE) {
    await reply("/ask requires KV (ASK_CACHE).");
    return;
  }
  if (message.from && !(await checkAskRateLimit(message.from.id, env))) {
    await reply("Rate limit reached: max 100 /ask queries per day.");
    return;
  }
  const style = message.from
    ? ((await env.ASK_CACHE.get(STYLE_KEY(message.from.id))) ?? undefined)
    : undefined;
  const status = await runOrEnqueue(env, {
    id: `ask-${message.from?.id ?? "anon"}-${message.message_id}`,
    kind: "ask",
    chatId: message.chat.id,
    messageId: message.message_id,
    userId: message.from?.id ?? null,
    request: question,
    model,
    style,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  if (status === "queued") {
    await reply("Taking a moment — queued, reply will arrive shortly.");
  }
}

export async function handleReassess(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier,
): Promise<void> {
  const request = text.replace(/^\/reassess\b/i, "").trim();
  if (!request) {
    await reply(
      "Describe in plain English which plant/zone to reassess and what's new, e.g. /reassess the milkweed by the back fence — monarchs aren't visiting and it's covered in aphids.",
    );
    return;
  }
  if (!env.ASK_CACHE) {
    await reply("/reassess requires KV (ASK_CACHE).");
    return;
  }
  if (message.from && !(await checkAskRateLimit(message.from.id, env))) {
    await reply("Rate limit reached: max 100 LLM queries per day.");
    return;
  }
  const status = await runOrEnqueue(env, {
    id: `reassess-${message.from?.id ?? "anon"}-${message.message_id}`,
    kind: "reassess",
    chatId: message.chat.id,
    messageId: message.message_id,
    userId: message.from?.id ?? null,
    request,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  if (status === "queued") {
    await reply("Working out which plant you mean — queued, reply will arrive shortly.");
  }
}

export async function handleResp(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier,
): Promise<void> {
  const m = text.match(/^\/resp([123])?\s+(\S[\s\S]*)$/i)!;
  const aliasOverride = m[1];
  const question = m[2].trim();
  if (!message.from || !env.ASK_CACHE) {
    await reply("No active /ask thread or /identify session.");
    return;
  }

  // Prefer a pending specimen (from /ask on a photo) over everything else: it's
  // the narrowest, most recent context, and a correction here is about that photo.
  const specimenRaw = await env.ASK_CACHE.get(PENDING_SPECIMEN_KEY(message.from.id));
  if (specimenRaw) {
    if (aliasOverride) {
      await reply(
        "Model override (/resp1, /resp2, /resp3) doesn't apply to a photo /ask — using the vision model. /cancel the specimen first to fall through to an /ask thread.",
      );
    }
    const pending: PendingSpecimen = JSON.parse(specimenRaw);
    if (!(await checkAskRateLimit(message.from.id, env))) {
      await reply("Rate limit reached: max 100 LLM queries per day.");
      return;
    }
    const status = await runOrEnqueue(env, {
      id: `describe-resp-${message.from.id}-${message.message_id}`,
      kind: "describe",
      chatId: message.chat.id,
      messageId: message.message_id,
      userId: message.from.id,
      fileId: pending.fileId,
      imgWidth: pending.width,
      imgHeight: pending.height,
      prompt: question,
      postedBy: pending.postedBy,
      priorPrompts: pending.userPrompts ?? [],
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    if (status === "queued") {
      await reply("Revising — updated proposal will arrive shortly.");
    }
    return;
  }

  // Prefer a pending /identify session over the /ask thread: it's narrower in
  // scope and shorter-lived (1h TTL), so a follow-up here is almost certainly
  // about the photo just identified.
  const identifyRaw = await env.ASK_CACHE.get(PENDING_IDENTIFY_KEY(message.from.id));
  if (identifyRaw) {
    if (aliasOverride) {
      await reply(
        "Model override (/resp1, /resp2, /resp3) doesn't apply to /identify refinement — using the identify model. Use /cancel first if you wanted /resp on an /ask thread.",
      );
    }
    const pending: PendingIdentify = JSON.parse(identifyRaw);
    const status = await runOrEnqueue(env, {
      id: `identify-resp-${message.from.id}-${message.message_id}`,
      kind: "identify",
      chatId: message.chat.id,
      messageId: message.message_id,
      userId: message.from.id,
      fileId: pending.fileId,
      imgWidth: pending.width,
      imgHeight: pending.height,
      prompt: question,
      postedBy: pending.postedBy,
      priorCandidates: pending.candidates,
      priorPrompts: pending.userPrompts ?? [],
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    if (status === "queued") {
      await reply("Refining identification — updated options will arrive shortly.");
    }
    return;
  }

  const raw = await env.ASK_CACHE.get(THREAD_KEY(message.from.id));
  if (!raw) {
    await reply("No active /ask thread or /identify session. Start one with /ask or /identify.");
    return;
  }
  const thread: Thread = JSON.parse(raw);
  const model = aliasOverride ? MODEL_ALIASES[aliasOverride] : thread.model;
  if (!(await checkAskRateLimit(message.from.id, env))) {
    await reply("Rate limit reached: max 100 /ask queries per day.");
    return;
  }
  const style = (await env.ASK_CACHE.get(STYLE_KEY(message.from.id))) ?? undefined;
  const status = await runOrEnqueue(env, {
    id: `resp-${message.from.id}-${message.message_id}`,
    kind: "ask",
    chatId: message.chat.id,
    messageId: message.message_id,
    userId: message.from.id,
    request: question,
    model,
    history: thread.history,
    style,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  if (status === "queued") {
    await reply("Taking a moment — queued, reply will arrive shortly.");
  }
}

export async function handleAnalyzeLoad(env: Env, reply: Replier): Promise<void> {
  const result = await analyzeStatus(env);
  if (result.kind === "no-run") {
    await reply("No analyze run pending. Run /analyze [zone] to start one.");
    return;
  }
  const scope = result.zoneFilter ? ` (zone ${result.zoneFilter})` : "";
  const tokens = formatAnalyzeUsage(result.promptTokens, result.outputTokens);
  const status =
    result.kind === "done"
      ? "Done"
      : `Running (${result.remaining} remaining, cron drains every minute)`;
  await reply(
    `${status}${scope}: ${result.succeeded}/${result.total} succeeded, ${result.failed} failed. Tokens: ${tokens}. Elapsed: ${result.elapsed}.`,
  );
}

export async function handleAnalyzeCancel(env: Env, reply: Replier): Promise<void> {
  await clearAnalyzeRun(env);
  await reply("Cleared analyze queue and run state.");
}

export async function handleAnalyze(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier,
): Promise<void> {
  const zoneFilter = text.match(/^\/analyze(?:\s+(\S+))?$/i)![1]?.trim() || null;
  const result = await submitAnalyzeRun(env, zoneFilter, {
    chatId: message.chat.id,
    messageId: message.message_id,
  });
  await reply(
    result.ok
      ? `Queued ${result.enqueued} pair(s)${zoneFilter ? ` in zone ${zoneFilter}` : ""}. Cron drains the queue every minute — run /analyze-load to check progress, or wait for the completion summary.`
      : result.message,
  );
}

export async function handleCost(env: Env, reply: Replier): Promise<void> {
  const totals = await readCostTotals(env);
  await reply(formatCostReport(totals));
}
