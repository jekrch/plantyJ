import type { AnnotationEntry, Env, PicEntry, PlantRecord, TelegramMessage, Zone } from "./types";
import { type Replier } from "./telegram";
import { HELP_HEADER } from "./help";
import { MODEL_ALIASES, type ProposedCommand, type Thread } from "./ask";
import {
  submitAnalyzeRun,
  analyzeStatus,
  clearAnalyzeRun,
} from "./analyze";
import { enqueueJob } from "./jobs";
import { assertValidCode } from "./validation";
import {
  acceptBioclip,
  addAnnotationTag,
  addPicTag,
  removeAnnotationTag,
  removePicTag,
  deleteAnnotation,
  deletePic,
  deleteZone,
  deleteZonePic,
  isUpdatableField,
  readAnnotations,
  readGallery,
  updateBySeq,
  upsertAnnotation,
  upsertZone,
} from "./github";
import {
  handleRelate,
  handleRelations,
  handleRelType,
  handleRelTypes,
  handleUnrelate,
} from "./relationships";

interface PendingDo {
  proposals: ProposedCommand[];
  createdAt: string;
}

const PENDING_DO_KEY = (userId: number) => `pending:do:${userId}`;
const STYLE_KEY = (userId: number) => `style:${userId}`;
const THREAD_KEY = (userId: number) => `thread:${userId}`;
const ASK_DAILY_LIMIT = 100;
const CONFIRM_BATCH_RATE_PER_MIN = 25;

// ─── shared helpers ────────────────────────────────────────────────────────

async function checkAskRateLimit(userId: number, env: Env): Promise<boolean> {
  if (!env.ASK_CACHE) return true;
  const today = new Date().toISOString().slice(0, 10);
  const key = `ratelimit:ask:${userId}:${today}`;
  const raw = await env.ASK_CACHE.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= ASK_DAILY_LIMIT) return false;
  await env.ASK_CACHE.put(key, String(count + 1), { expirationTtl: 86400 });
  return true;
}

function joinLines(lines: (string | null | false | undefined)[]): string {
  return lines.filter(Boolean).join("\n");
}

// ─── list/format helpers ───────────────────────────────────────────────────

function buildPlantsText(plants: PlantRecord[]): string {
  if (plants.length === 0) return "No plants yet.";
  const lines = [...plants]
    .sort((a, b) => a.shortCode.localeCompare(b.shortCode))
    .map((p) => `  ${p.shortCode} — ${p.commonName ?? p.fullName ?? p.shortCode}`);
  return `Plants:\n${lines.join("\n")}`;
}

function buildTagsText(pics: PicEntry[], annotations: AnnotationEntry[]): string {
  const tags = new Set<string>();
  for (const p of pics) for (const t of p.tags) tags.add(t);
  for (const a of annotations) for (const t of a.tags) tags.add(t);
  if (tags.size === 0) return "No tags yet.";
  return `Tags:\n${[...tags].sort().map((t) => `  ${t}`).join("\n")}`;
}

function buildZonesText(zones: Zone[]): string {
  if (zones.length === 0) return "No zones yet. Add one with /addzone {code} {name}.";
  const lines = [...zones]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((z) => `  ${z.code} — ${z.name ?? "(unnamed)"}`);
  return `Zones:\n${lines.join("\n")}`;
}

// ─── /confirm parsing ──────────────────────────────────────────────────────

function parseConfirmIndices(text: string, max: number): number[] | "all" | "invalid" {
  const rest = text.slice("/confirm".length).trim();
  if (rest === "") return "all";
  const tokens = rest.split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const t of tokens) {
    const n = parseInt(t, 10);
    if (isNaN(n) || String(n) !== t || n < 1 || n > max) return "invalid";
    if (!out.includes(n)) out.push(n);
  }
  return out.length === 0 ? "invalid" : out;
}

// ─── /addtag and /removetag share this parser ──────────────────────────────

type TagTarget =
  | { kind: "pic"; seq: number; tag: string }
  | { kind: "annotation"; shortCode: string; zoneCode: string | null; tag: string }
  | { kind: "invalid" };

function parseTagCommand(rest: string): TagTarget {
  const parts = rest.split("//").map((s) => s.trim());

  if (parts.length === 1) {
    const spaceIdx = parts[0].indexOf(" ");
    if (spaceIdx === -1) return { kind: "invalid" };
    const first = parts[0].slice(0, spaceIdx).trim();
    const tag = parts[0].slice(spaceIdx + 1).trim();
    const seq = parseInt(first, 10);
    if (!isNaN(seq) && String(seq) === first) {
      return { kind: "pic", seq, tag };
    }
    return { kind: "annotation", shortCode: first, zoneCode: null, tag };
  }
  if (parts.length === 2) {
    return { kind: "annotation", shortCode: parts[0], zoneCode: null, tag: parts[1] };
  }
  if (parts.length === 3) {
    return { kind: "annotation", shortCode: parts[0], zoneCode: parts[1], tag: parts[2] };
  }
  return { kind: "invalid" };
}

const TAG_USAGE = (verb: string) =>
  `Invalid format. Use:\n  /${verb} {seq} {tag}\n  /${verb} {shortCode} // {tag}\n  /${verb} {shortCode} // {zoneCode} // {tag}`;

// ─── individual handlers ───────────────────────────────────────────────────

async function handleAskStyle(text: string, message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
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

async function handleShowStyle(message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  const style =
    message.from && env.ASK_CACHE
      ? await env.ASK_CACHE.get(STYLE_KEY(message.from.id))
      : null;
  await reply(style ? `Current style: ${style}` : "No style set. Use /askstyle {description} to set one.");
}

async function handleCancel(message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  if (message.from && env.ASK_CACHE) {
    await env.ASK_CACHE.delete(PENDING_DO_KEY(message.from.id)).catch(() => {});
  }
  await reply("Cancelled. No commands run.");
}

async function handleConfirm(text: string, message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  if (!message.from || !env.ASK_CACHE) {
    await reply("/confirm requires KV and a known user.");
    return;
  }
  const raw = await env.ASK_CACHE.get(PENDING_DO_KEY(message.from.id));
  if (!raw) {
    await reply("Nothing to confirm. Start with /ask {request}.");
    return;
  }
  const pending: PendingDo = JSON.parse(raw);
  const sel = parseConfirmIndices(text, pending.proposals.length);
  if (sel === "invalid") {
    await reply(
      `Invalid selection. Use /confirm (all) or /confirm N [N ...] with numbers 1..${pending.proposals.length}.`
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
    `Queued ${commands.length} command(s) — batched in chunks of ${CONFIRM_BATCH_RATE_PER_MIN}/min (~${etaMin} min). Summary will arrive when complete.`
  );
}

async function handleAsk(text: string, message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
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
    ? (await env.ASK_CACHE.get(STYLE_KEY(message.from.id))) ?? undefined
    : undefined;
  await enqueueJob(env, {
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
  await reply("Queued — reply will arrive shortly.");
}

async function handleResp(text: string, message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/resp([123])?\s+(\S[\s\S]*)$/i)!;
  const aliasOverride = m[1];
  const question = m[2].trim();
  if (!message.from || !env.ASK_CACHE) {
    await reply("No active /ask thread.");
    return;
  }
  const raw = await env.ASK_CACHE.get(THREAD_KEY(message.from.id));
  if (!raw) {
    await reply("No active /ask thread. Start one with /ask.");
    return;
  }
  const thread: Thread = JSON.parse(raw);
  const model = aliasOverride ? MODEL_ALIASES[aliasOverride] : thread.model;
  if (!(await checkAskRateLimit(message.from.id, env))) {
    await reply("Rate limit reached: max 100 /ask queries per day.");
    return;
  }
  const style = (await env.ASK_CACHE.get(STYLE_KEY(message.from.id))) ?? undefined;
  await enqueueJob(env, {
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
  await reply("Queued — reply will arrive shortly.");
}

async function handleAnalyzeLoad(env: Env, reply: Replier): Promise<void> {
  const result = await analyzeStatus(env);
  if (result.kind === "no-run") {
    await reply("No analyze run pending. Run /analyze [zone] to start one.");
    return;
  }
  const scope = result.zoneFilter ? ` (zone ${result.zoneFilter})` : "";
  const tokens = `${result.promptTokens.toLocaleString()} in / ${result.outputTokens.toLocaleString()} out`;
  const status =
    result.kind === "done"
      ? "Done"
      : `Running (${result.remaining} remaining, cron drains every minute)`;
  await reply(
    `${status}${scope}: ${result.succeeded}/${result.total} succeeded, ${result.failed} failed. Tokens: ${tokens}. Elapsed: ${result.elapsed}.`
  );
}

async function handleAnalyzeCancel(env: Env, reply: Replier): Promise<void> {
  await clearAnalyzeRun(env);
  await reply("Cleared analyze queue and run state.");
}

async function handleAnalyze(text: string, message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  const zoneFilter = text.match(/^\/analyze(?:\s+(\S+))?$/i)![1]?.trim() || null;
  const result = await submitAnalyzeRun(env, zoneFilter, {
    chatId: message.chat.id,
    messageId: message.message_id,
  });
  await reply(
    result.ok
      ? `Queued ${result.enqueued} pair(s)${zoneFilter ? ` in zone ${zoneFilter}` : ""}. Cron drains the queue every minute — run /analyze-load to check progress, or wait for the completion summary.`
      : result.message
  );
}

async function handlePlants(env: Env, reply: Replier): Promise<void> {
  const { gallery } = await readGallery(env);
  await reply(buildPlantsText(gallery.plants));
}

async function handleTagsList(env: Env, reply: Replier): Promise<void> {
  const [{ gallery }, annotations] = await Promise.all([readGallery(env), readAnnotations(env)]);
  await reply(buildTagsText(gallery.pics, annotations));
}

async function handleZonesList(env: Env, reply: Replier): Promise<void> {
  const { gallery } = await readGallery(env);
  await reply(buildZonesText(gallery.zones));
}

async function handleAddZone(text: string, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/addzone\s+(\S+)(?:\s+(\S[\s\S]*))?$/)!;
  const code = m[1];
  assertValidCode("zoneCode", code);
  const name = m[2]?.trim() || null;
  const zone = await upsertZone(env, code, name);
  await reply(`Saved zone: ${zone.code}${zone.name ? ` — ${zone.name}` : ""}`);
}

async function handleRenameZone(text: string, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/renamezone\s+(\S+)\s+(\S[\s\S]*)$/)!;
  const code = m[1];
  assertValidCode("zoneCode", code);
  const name = m[2].trim();
  const zone = await upsertZone(env, code, name || null);
  await reply(`Zone ${zone.code} renamed to "${zone.name}"`);
}

async function handleDeleteZonePic(text: string, env: Env, reply: Replier): Promise<void> {
  const id = text.match(/^\/deletezonepic\s+(\S+)$/)![1];
  const removed = await deleteZonePic(env, id);
  await reply(removed ? `Deleted zone pic: ${removed.zoneCode} (${removed.id})` : `No zone pic found with id ${id}.`);
}

async function handleDeleteZone(text: string, env: Env, reply: Replier): Promise<void> {
  const code = text.match(/^\/deletezone\s+(\S+)$/)![1];
  assertValidCode("zoneCode", code);
  const result = await deleteZone(env, code);
  if (!result.zone) {
    await reply(`No zone found with code "${code}".`);
  } else if (result.inUseBy.length > 0) {
    const refs = Array.from(new Set(result.inUseBy)).join(", ");
    await reply(`Cannot delete zone "${code}" — still used by: ${refs}`);
  } else {
    await reply(`Deleted zone: ${code}`);
  }
}

async function handleDeletePic(text: string, env: Env, reply: Replier): Promise<void> {
  const seq = parseInt(text.match(/^\/delete\s+(\d+)$/)![1], 10);
  const removed = await deletePic(env, seq);
  await reply(removed ? `Deleted pic #${seq}: ${removed.shortCode}` : `No pic found with ID ${seq}.`);
}

async function handleAccept(text: string, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/accept\s+(\d+)(?:\s+(\S+))?$/)!;
  const seq = parseInt(m[1], 10);
  const targetShortCode = m[2] || null;
  if (targetShortCode) assertValidCode("shortCode", targetShortCode);
  const result = await acceptBioclip(env, seq, targetShortCode);

  if (result === "no-pic") {
    await reply(`No pic found with ID ${seq}.`);
    return;
  }
  if (result === "no-prediction") {
    await reply(
      `Pic #${seq} has no BioCLIP prediction yet. The metadata action runs after each commit — try again in a few minutes.`
    );
    return;
  }
  await reply(
    joinLines([
      result.renamedFrom
        ? `Accepted #${seq}: ${result.renamedFrom} → ${result.plant.shortCode}`
        : `Accepted #${seq}: ${result.plant.shortCode}`,
      result.plant.fullName ? `  Full: ${result.plant.fullName}` : null,
      result.plant.commonName ? `  Common: ${result.plant.commonName}` : null,
    ])
  );
}

async function handleUpdate(text: string, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/update\s+(\d+)\s+(\S+)\s+(\S[\s\S]*)$/)!;
  const seq = parseInt(m[1], 10);
  const field = m[2];
  const value = m[3].trim();

  if (!isUpdatableField(field)) {
    await reply(`Invalid field "${field}". Updatable: shortCode, fullName, commonName, zoneCode, tags, description`);
    return;
  }
  if (field === "shortCode" || field === "zoneCode") {
    assertValidCode(field, value);
  }
  const updated = await updateBySeq(env, seq, field, value);
  await reply(
    updated
      ? `Updated pic #${seq}: ${field} → "${value}"\n→ ${updated.pic.shortCode}`
      : `No pic found with ID ${seq}.`
  );
}

async function handleAnnotate(text: string, env: Env, reply: Replier): Promise<void> {
  const parts = text.slice("/annotate ".length).split("//").map((s) => s.trim());
  const isField = (s: string): s is "tags" | "description" => s === "tags" || s === "description";

  let shortCode: string, zoneCode: string | null, field: "tags" | "description", value: string;

  if (parts.length >= 3 && isField(parts[1])) {
    shortCode = parts[0];
    zoneCode = null;
    field = parts[1];
    value = parts.slice(2).join("//");
  } else if (parts.length >= 4 && isField(parts[2])) {
    shortCode = parts[0];
    zoneCode = parts[1];
    field = parts[2];
    value = parts.slice(3).join("//");
  } else {
    await reply(
      `Invalid format. Use:\n  /annotate shortCode // tags // value\n  /annotate shortCode // zoneCode // tags // value`
    );
    return;
  }

  assertValidCode("shortCode", shortCode);
  if (zoneCode) assertValidCode("zoneCode", zoneCode);

  const entry = await upsertAnnotation(env, shortCode, zoneCode, field, value.trim() === "-" ? "" : value);
  const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
  const lines = joinLines([
    `Annotated ${scope}:`,
    entry.tags.length > 0 ? `  Tags: ${entry.tags.join(", ")}` : null,
    entry.description ? `  Note: ${entry.description}` : null,
  ]);
  await reply(lines || `Cleared annotation for ${scope}.`);
}

async function handleAddTag(text: string, env: Env, reply: Replier): Promise<void> {
  const target = parseTagCommand(text.slice("/addtag ".length));
  if (target.kind === "invalid") {
    await reply(TAG_USAGE("addtag"));
    return;
  }
  if (target.kind === "pic") {
    const pic = await addPicTag(env, target.seq, target.tag);
    await reply(
      pic
        ? `Added tag "${target.tag}" to pic #${target.seq} (${pic.shortCode}). Tags: ${pic.tags.join(", ")}`
        : `No pic found with ID ${target.seq}.`
    );
    return;
  }
  assertValidCode("shortCode", target.shortCode);
  if (target.zoneCode) assertValidCode("zoneCode", target.zoneCode);
  const { entry, added } = await addAnnotationTag(env, target.shortCode, target.zoneCode, target.tag);
  const scope = target.zoneCode ? `${target.shortCode} / ${target.zoneCode}` : target.shortCode;
  await reply(
    added
      ? `Added tag "${target.tag}" to ${scope}. Tags: ${entry.tags.join(", ")}`
      : `Tag "${target.tag}" already present on ${scope}.`
  );
}

async function handleRemoveTag(text: string, env: Env, reply: Replier): Promise<void> {
  const target = parseTagCommand(text.slice("/removetag ".length));
  if (target.kind === "invalid") {
    await reply(TAG_USAGE("removetag"));
    return;
  }
  if (target.kind === "pic") {
    const result = await removePicTag(env, target.seq, target.tag);
    if (!result) {
      await reply(`No pic found with ID ${target.seq}.`);
    } else if (!result.removed) {
      await reply(`Tag "${target.tag}" not present on pic #${target.seq} (${result.pic.shortCode}).`);
    } else {
      const tags = result.pic.tags.length > 0 ? result.pic.tags.join(", ") : "(none)";
      await reply(`Removed tag "${target.tag}" from pic #${target.seq} (${result.pic.shortCode}). Tags: ${tags}`);
    }
    return;
  }
  assertValidCode("shortCode", target.shortCode);
  if (target.zoneCode) assertValidCode("zoneCode", target.zoneCode);
  const { entry, removed } = await removeAnnotationTag(env, target.shortCode, target.zoneCode, target.tag);
  const scope = target.zoneCode ? `${target.shortCode} / ${target.zoneCode}` : target.shortCode;
  if (!removed) {
    await reply(`Tag "${target.tag}" not present on ${scope}.`);
  } else {
    const tags = entry && entry.tags.length > 0 ? entry.tags.join(", ") : "(none)";
    await reply(`Removed tag "${target.tag}" from ${scope}. Tags: ${tags}`);
  }
}

async function handleDeleteAnnotation(text: string, env: Env, reply: Replier): Promise<void> {
  const parts = text.slice("/deleteannotation ".length).split("//").map((s) => s.trim());
  const shortCode = parts[0];
  const zoneCode = parts[1] || null;
  assertValidCode("shortCode", shortCode);
  if (zoneCode) assertValidCode("zoneCode", zoneCode);
  const removed = await deleteAnnotation(env, shortCode, zoneCode);
  const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
  await reply(removed ? `Deleted annotation for ${scope}.` : `No annotation found for ${scope}.`);
}

// ─── dispatcher ────────────────────────────────────────────────────────────

/**
 * Try each registered text command in order. Returns true if one matched and
 * was handled (regardless of success/failure). Errors during a handler are
 * caught and reported as a plain "Error: …" reply.
 */
export async function handleTextCommand(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier
): Promise<boolean> {
  const handlers: Array<[RegExp | string, () => Promise<void>]> = [
    [/^\/askstyle(\s|$)/i, () => handleAskStyle(text, message, env, reply)],
    ["/showstyle", () => handleShowStyle(message, env, reply)],
    ["/cancel", () => handleCancel(message, env, reply)],
    [/^\/confirm(\s|\t|$)/, () => handleConfirm(text, message, env, reply)],
    [/^\/ask([123])?\s/i, () => handleAsk(text, message, env, reply)],
    [/^\/resp([123])?\s/i, () => handleResp(text, message, env, reply)],
    ["/analyze-load", () => handleAnalyzeLoad(env, reply)],
    ["/analyze-cancel", () => handleAnalyzeCancel(env, reply)],
    [/^\/analyze(\s|$)/i, () => handleAnalyze(text, message, env, reply)],
    [/^\/(help|start)$/, async () => { await reply(HELP_HEADER); }],
    ["/plants", () => handlePlants(env, reply)],
    ["/tags", () => handleTagsList(env, reply)],
    ["/zones", () => handleZonesList(env, reply)],
    [/^\/addzone\s/, () => handleAddZone(text, env, reply)],
    [/^\/renamezone\s/, () => handleRenameZone(text, env, reply)],
    [/^\/deletezonepic\s/, () => handleDeleteZonePic(text, env, reply)],
    [/^\/deletezone\s/, () => handleDeleteZone(text, env, reply)],
    [/^\/delete\s+\d+$/, () => handleDeletePic(text, env, reply)],
    [/^\/accept\s/, () => handleAccept(text, env, reply)],
    [/^\/update\s/, () => handleUpdate(text, env, reply)],
    [/^\/annotate\s/, () => handleAnnotate(text, env, reply)],
    [/^\/addtag\s/, () => handleAddTag(text, env, reply)],
    [/^\/removetag\s/, () => handleRemoveTag(text, env, reply)],
    [/^\/deleteannotation\s/, () => handleDeleteAnnotation(text, env, reply)],
    [/^\/relate\s/, () => handleRelate(text, env, reply)],
    [/^\/unrelate\s/, () => handleUnrelate(text, env, reply)],
    [/^\/relations\s/, () => handleRelations(text, env, reply)],
    ["/reltypes", () => handleRelTypes(env, reply)],
    [/^\/reltype\s/, () => handleRelType(text, env, reply)],
  ];

  for (const [pattern, run] of handlers) {
    const matched = typeof pattern === "string" ? text === pattern : pattern.test(text);
    if (!matched) continue;
    try {
      await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await reply(`Error: ${msg}`);
    }
    return true;
  }
  return false;
}
