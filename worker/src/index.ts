import type { AnnotationEntry, Env, PicEntry, PlantRecord, TelegramUpdate, Zone, ZonePicEntry } from "./types";
import { parseCaption, resolveFields, UNIDENTIFIED_CODE, UNIDENTIFIED_PREFIX } from "./caption";
import { downloadFile, sendReply } from "./telegram";
import { HELP_HEADER } from "./help";
import { answerQuestion, MODEL_ALIASES, type Thread } from "./ask";
import {
  submitAnalyzeRun,
  analyzeStatus,
  processAnalyzeTick,
  clearAnalyzeRun,
} from "./analyze";
import {
  acceptBioclip,
  addAnnotationTag,
  addPicTag,
  appendPic,
  appendZonePic,
  arrayBufferToBase64,
  commitFile,
  deleteAnnotation,
  deletePic,
  deleteZone,
  deleteZonePic,
  isUpdatableField,
  nextSeq,
  readAnnotations,
  readGallery,
  updateBySeq,
  upsertAnnotation,
  upsertZone,
} from "./github";

function isAllowedUser(userId: number | undefined, env: Env): boolean {
  if (!env.ALLOWED_USER_IDS) return true;
  if (userId === undefined) return false;
  return env.ALLOWED_USER_IDS.split(",").some((id) => id.trim() === String(userId));
}

async function checkAskRateLimit(userId: number, env: Env): Promise<boolean> {
  if (!env.ASK_CACHE) return true;
  const today = new Date().toISOString().slice(0, 10);
  const key = `ratelimit:ask:${userId}:${today}`;
  const raw = await env.ASK_CACHE.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= 100) return false;
  await env.ASK_CACHE.put(key, String(count + 1), { expirationTtl: 86400 });
  return true;
}

function buildHelpText(): string {
  return HELP_HEADER;
}

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!env.WEBHOOK_SECRET) {
      return new Response("Webhook secret not configured", { status: 500 });
    }
    if (secret !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 403 });
    }

    const update: TelegramUpdate = await request.json();
    const message = update.message;

    if (!message) return new Response("OK");

    if (String(message.chat.id) !== env.TELEGRAM_ALLOWED_CHAT_ID) {
      return new Response("OK");
    }

    if (!isAllowedUser(message.from?.id, env)) {
      return new Response("OK");
    }

    if (message.text) {
      const text = message.text.trim();

      try {
        const askStyleMatch = text.match(/^\/askstyle(?:\s+([\s\S]+))?$/i);
        if (askStyleMatch) {
          const styleText = askStyleMatch[1]?.trim();
          if (!message.from || !env.ASK_CACHE) {
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, "Style preferences require user context.");
            return new Response("OK");
          }
          if (styleText) {
            await env.ASK_CACHE.put(`style:${message.from.id}`, styleText);
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, `Style set: ${styleText}`);
          } else {
            await env.ASK_CACHE.delete(`style:${message.from.id}`);
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, "Style cleared.");
          }
          return new Response("OK");
        }

        if (text === "/showstyle") {
          const style = message.from && env.ASK_CACHE
            ? await env.ASK_CACHE.get(`style:${message.from.id}`)
            : null;
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            style ? `Current style: ${style}` : "No style set. Use /askstyle {description} to set one."
          );
          return new Response("OK");
        }

        const askMatch = text.match(/^\/ask([123])?\s+([\s\S]+)$/i);
        if (askMatch) {
          const alias = askMatch[1] ?? "3";
          const question = askMatch[2].trim();
          const model = MODEL_ALIASES[alias];
          if (message.from && !await checkAskRateLimit(message.from.id, env)) {
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, "Rate limit reached: max 100 /ask queries per day.");
            return new Response("OK");
          }
          const style = message.from && env.ASK_CACHE
            ? await env.ASK_CACHE.get(`style:${message.from.id}`) ?? undefined
            : undefined;
          const { reply, thread } = await answerQuestion(question, env, model, undefined, style);
          await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, reply);
          if (message.from && env.ASK_CACHE) {
            await env.ASK_CACHE.put(`thread:${message.from.id}`, JSON.stringify(thread));
          }
          return new Response("OK");
        }

        const respMatch = text.match(/^\/resp([123])?\s+([\s\S]+)$/i);
        if (respMatch) {
          const aliasOverride = respMatch[1];
          const question = respMatch[2].trim();
          if (!message.from || !env.ASK_CACHE) {
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, "No active /ask thread.");
            return new Response("OK");
          }
          const raw = await env.ASK_CACHE.get(`thread:${message.from.id}`);
          if (!raw) {
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, "No active /ask thread. Start one with /ask.");
            return new Response("OK");
          }
          const thread: Thread = JSON.parse(raw);
          const model = aliasOverride ? MODEL_ALIASES[aliasOverride] : thread.model;
          if (!await checkAskRateLimit(message.from.id, env)) {
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, "Rate limit reached: max 100 /ask queries per day.");
            return new Response("OK");
          }
          const style = await env.ASK_CACHE.get(`style:${message.from.id}`) ?? undefined;
          const { reply, thread: updatedThread } = await answerQuestion(question, env, model, thread.history, style);
          await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, reply);
          await env.ASK_CACHE.put(`thread:${message.from.id}`, JSON.stringify(updatedThread));
          return new Response("OK");
        }

        if (text === "/analyze-load") {
          try {
            const result = await analyzeStatus(env);
            let reply: string;
            if (result.kind === "no-run") {
              reply = "No analyze run pending. Run /analyze [zone] to start one.";
            } else {
              const scope = result.zoneFilter ? ` (zone ${result.zoneFilter})` : "";
              const tokens = `${result.promptTokens.toLocaleString()} in / ${result.outputTokens.toLocaleString()} out`;
              const status =
                result.kind === "done"
                  ? "Done"
                  : `Running (${result.remaining} remaining, cron drains every minute)`;
              reply = `${status}${scope}: ${result.succeeded}/${result.total} succeeded, ${result.failed} failed. Tokens: ${tokens}. Elapsed: ${result.elapsed}.`;
            }
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, reply);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, `Analyze-load failed: ${msg}`);
          }
          return new Response("OK");
        }

        if (text === "/analyze-cancel") {
          try {
            await clearAnalyzeRun(env);
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, "Cleared analyze queue and run state.");
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, `Cancel failed: ${msg}`);
          }
          return new Response("OK");
        }

        const analyzeMatch = text.match(/^\/analyze(?:\s+(\S+))?$/i);
        if (analyzeMatch) {
          const zoneFilter = analyzeMatch[1]?.trim() || null;
          try {
            const result = await submitAnalyzeRun(env, zoneFilter);
            const reply = result.ok
              ? `Queued ${result.enqueued} pair(s)${zoneFilter ? ` in zone ${zoneFilter}` : ""}. Cron drains the queue every minute — run /analyze-load to check progress.`
              : result.message;
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, reply);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, `Analyze submit failed: ${msg}`);
          }
          return new Response("OK");
        }

        if (text === "/help" || text === "/start") {
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            buildHelpText()
          );
          return new Response("OK");
        }

        if (text === "/plants") {
          const { gallery } = await readGallery(env);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            buildPlantsText(gallery.plants)
          );
          return new Response("OK");
        }

        if (text === "/tags") {
          const [{ gallery }, annotations] = await Promise.all([
            readGallery(env),
            readAnnotations(env),
          ]);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            buildTagsText(gallery.pics, annotations)
          );
          return new Response("OK");
        }

        if (text === "/zones") {
          const { gallery } = await readGallery(env);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            buildZonesText(gallery.zones)
          );
          return new Response("OK");
        }

        const addZoneMatch = text.match(/^\/addzone\s+(\S+)(?:\s+([\s\S]+))?$/);
        if (addZoneMatch) {
          const code = addZoneMatch[1];
          const name = addZoneMatch[2]?.trim() || null;
          const zone = await upsertZone(env, code, name);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            `Saved zone: ${zone.code}${zone.name ? ` — ${zone.name}` : ""}`
          );
          return new Response("OK");
        }

        const renameZoneMatch = text.match(/^\/renamezone\s+(\S+)\s+([\s\S]+)$/);
        if (renameZoneMatch) {
          const code = renameZoneMatch[1];
          const name = renameZoneMatch[2].trim();
          const zone = await upsertZone(env, code, name || null);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            `Zone ${zone.code} renamed to "${zone.name}"`
          );
          return new Response("OK");
        }

        const deleteZonePicMatch = text.match(/^\/deletezonepic\s+(\S+)$/);
        if (deleteZonePicMatch) {
          const id = deleteZonePicMatch[1];
          const removed = await deleteZonePic(env, id);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            removed
              ? `Deleted zone pic: ${removed.zoneCode} (${removed.id})`
              : `No zone pic found with id ${id}.`
          );
          return new Response("OK");
        }

        const deleteZoneMatch = text.match(/^\/deletezone\s+(\S+)$/);
        if (deleteZoneMatch) {
          const code = deleteZoneMatch[1];
          const result = await deleteZone(env, code);
          let reply: string;
          if (!result.zone) {
            reply = `No zone found with code "${code}".`;
          } else if (result.inUseBy.length > 0) {
            const refs = Array.from(new Set(result.inUseBy)).join(", ");
            reply = `Cannot delete zone "${code}" — still used by: ${refs}`;
          } else {
            reply = `Deleted zone: ${code}`;
          }
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            reply
          );
          return new Response("OK");
        }

        const deleteMatch = text.match(/^\/delete\s+(\d+)$/);
        if (deleteMatch) {
          const seq = parseInt(deleteMatch[1], 10);
          const removed = await deletePic(env, seq);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            removed
              ? `Deleted pic #${seq}: ${removed.shortCode}`
              : `No pic found with ID ${seq}.`
          );
          return new Response("OK");
        }

        const acceptMatch = text.match(/^\/accept\s+(\d+)(?:\s+(\S+))?$/);
        if (acceptMatch) {
          const seq = parseInt(acceptMatch[1], 10);
          const targetShortCode = acceptMatch[2] || null;
          const result = await acceptBioclip(env, seq, targetShortCode);

          let reply: string;
          if (result === "no-pic") {
            reply = `No pic found with ID ${seq}.`;
          } else if (result === "no-prediction") {
            reply = `Pic #${seq} has no BioCLIP prediction yet. The metadata action runs after each commit — try again in a few minutes.`;
          } else {
            const lines = [
              result.renamedFrom
                ? `Accepted #${seq}: ${result.renamedFrom} → ${result.plant.shortCode}`
                : `Accepted #${seq}: ${result.plant.shortCode}`,
              result.plant.fullName ? `  Full: ${result.plant.fullName}` : null,
              result.plant.commonName ? `  Common: ${result.plant.commonName}` : null,
            ].filter(Boolean);
            reply = lines.join("\n");
          }

          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            reply
          );
          return new Response("OK");
        }

        const updateMatch = text.match(/^\/update\s+(\d+)\s+(\S+)\s+([\s\S]+)$/);
        if (updateMatch) {
          const seq = parseInt(updateMatch[1], 10);
          const field = updateMatch[2];
          const value = updateMatch[3].trim();

          if (!isUpdatableField(field)) {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `Invalid field "${field}". Updatable: shortCode, fullName, commonName, zoneCode, tags, description`
            );
            return new Response("OK");
          }

          const updated = await updateBySeq(env, seq, field, value);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            updated
              ? `Updated pic #${seq}: ${field} → "${value}"\n→ ${updated.pic.shortCode}`
              : `No pic found with ID ${seq}.`
          );
          return new Response("OK");
        }

        if (text.startsWith("/annotate ")) {
          const parts = text.slice("/annotate ".length).split("//").map((s) => s.trim());
          const isField = (s: string): s is "tags" | "description" =>
            s === "tags" || s === "description";

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
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `Invalid format. Use:\n  /annotate shortCode // tags // value\n  /annotate shortCode // zoneCode // tags // value`
            );
            return new Response("OK");
          }

          const entry = await upsertAnnotation(env, shortCode, zoneCode, field, value.trim() === "-" ? "" : value);
          const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
          const lines = [
            `Annotated ${scope}:`,
            entry.tags.length > 0 ? `  Tags: ${entry.tags.join(", ")}` : null,
            entry.description ? `  Note: ${entry.description}` : null,
          ].filter(Boolean);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            lines.join("\n") || `Cleared annotation for ${scope}.`
          );
          return new Response("OK");
        }

        if (text.startsWith("/addtag ")) {
          const parts = text.slice("/addtag ".length).split("//").map((s) => s.trim());

          if (parts.length === 1) {
            // /addtag {seq} {tag}  or  /addtag {shortCode} {tag} (plant-level)
            const spaceIdx = parts[0].indexOf(" ");
            if (spaceIdx === -1) {
              await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id,
                `Invalid format. Use:\n  /addtag {seq} {tag}\n  /addtag {shortCode} // {tag}\n  /addtag {shortCode} // {zoneCode} // {tag}`);
              return new Response("OK");
            }
            const first = parts[0].slice(0, spaceIdx).trim();
            const tag = parts[0].slice(spaceIdx + 1).trim();
            const seq = parseInt(first, 10);
            if (!isNaN(seq) && String(seq) === first) {
              const pic = await addPicTag(env, seq, tag);
              await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id,
                pic
                  ? `Added tag "${tag}" to pic #${seq} (${pic.shortCode}). Tags: ${pic.tags.join(", ")}`
                  : `No pic found with ID ${seq}.`);
            } else {
              const { entry, added } = await addAnnotationTag(env, first, null, tag);
              await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id,
                added
                  ? `Added tag "${tag}" to ${first}. Tags: ${entry.tags.join(", ")}`
                  : `Tag "${tag}" already present on ${first}.`);
            }
          } else if (parts.length === 2) {
            // /addtag {shortCode} // {tag}
            const { entry, added } = await addAnnotationTag(env, parts[0], null, parts[1]);
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id,
              added
                ? `Added tag "${parts[1]}" to ${parts[0]}. Tags: ${entry.tags.join(", ")}`
                : `Tag "${parts[1]}" already present on ${parts[0]}.`);
          } else if (parts.length === 3) {
            // /addtag {shortCode} // {zoneCode} // {tag}
            const { entry, added } = await addAnnotationTag(env, parts[0], parts[1], parts[2]);
            const scope = `${parts[0]} / ${parts[1]}`;
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id,
              added
                ? `Added tag "${parts[2]}" to ${scope}. Tags: ${entry.tags.join(", ")}`
                : `Tag "${parts[2]}" already present on ${scope}.`);
          } else {
            await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id,
              `Invalid format. Use:\n  /addtag {seq} {tag}\n  /addtag {shortCode} // {tag}\n  /addtag {shortCode} // {zoneCode} // {tag}`);
          }
          return new Response("OK");
        }

        if (text.startsWith("/deleteannotation ")) {
          const parts = text.slice("/deleteannotation ".length).split("//").map((s) => s.trim());
          const shortCode = parts[0];
          const zoneCode = parts[1] || null;
          const removed = await deleteAnnotation(env, shortCode, zoneCode);
          const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            removed ? `Deleted annotation for ${scope}.` : `No annotation found for ${scope}.`
          );
          return new Response("OK");
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        await sendReply(
          env.TELEGRAM_BOT_TOKEN,
          message.chat.id,
          message.message_id,
          `Error: ${errorMessage}`
        );
        return new Response("OK");
      }

      return new Response("OK");
    }

    if (message.photo && !message.caption) {
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        "Photo received but no caption.\n\nFormat:\nshortCode // fullName // commonName // zones // tags // description\n\nOr for a zone photo:\n/zonepic {zoneCode} [// description]"
      );
      return new Response("OK");
    }

    if (!message.photo || !message.caption) return new Response("OK");

    const zonePicMatch = message.caption.trim().match(/^\/zonepic\s+(\S+)(?:\s*\/\/\s*([\s\S]+))?$/);
    if (zonePicMatch) {
      try {
        const zoneCode = zonePicMatch[1];
        const description = zonePicMatch[2]?.trim() || null;

        const { gallery } = await readGallery(env);
        const existingZone = gallery.zones.find((z) => z.code === zoneCode);
        const zoneUpsert: Zone | null = existingZone ? null : { code: zoneCode, name: null };

        const postedBy =
          message.from?.first_name || message.from?.username || "unknown";

        const photo = message.photo[message.photo.length - 1];
        const imageBytes = await downloadFile(photo.file_id, env.TELEGRAM_BOT_TOKEN);

        const timestamp = Math.floor(Date.now() / 1000);
        const filename = `${timestamp}.jpg`;
        const repoImagePath = `public/images/zones/${zoneCode}/${filename}`;
        const browserImagePath = `images/zones/${zoneCode}/${filename}`;
        const id = `${zoneCode}-${timestamp}`;

        const base64Image = arrayBufferToBase64(imageBytes);
        await commitFile(
          env,
          repoImagePath,
          base64Image,
          `Add zone photo: ${zoneCode}`
        );

        const entry: ZonePicEntry = {
          id,
          zoneCode,
          image: browserImagePath,
          addedAt: new Date().toISOString(),
          postedBy,
          description,
        };

        await appendZonePic(env, entry, zoneUpsert);

        const zoneLabel = existingZone?.name
          ? `${existingZone.name} (${zoneCode})`
          : zoneCode;
        const lines = [
          `Added zone pic for ${zoneLabel}`,
          `  id: ${id}`,
          description ? `  Note: ${description}` : null,
          `  → ${browserImagePath}`,
        ].filter(Boolean);

        await sendReply(
          env.TELEGRAM_BOT_TOKEN,
          message.chat.id,
          message.message_id,
          lines.join("\n")
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        await sendReply(
          env.TELEGRAM_BOT_TOKEN,
          message.chat.id,
          message.message_id,
          `Error: ${errorMessage}`
        );
      }
      return new Response("OK");
    }

    try {
      const parsed = parseCaption(message.caption);

      const { gallery } = await readGallery(env);
      const { pic: resolvedPic, plantUpsert, zoneUpserts, annotationTags } = resolveFields(
        parsed,
        gallery.pics,
        gallery.plants,
        gallery.zones
      );

      const postedBy =
        message.from?.first_name || message.from?.username || "unknown";

      const seq = nextSeq(gallery);
      const isUnidentified = resolvedPic.shortCode === UNIDENTIFIED_CODE;
      const finalShortCode = isUnidentified
        ? `${UNIDENTIFIED_PREFIX}${seq}`
        : resolvedPic.shortCode;

      const photo = message.photo[message.photo.length - 1];
      const imageBytes = await downloadFile(photo.file_id, env.TELEGRAM_BOT_TOKEN);

      const timestamp = Math.floor(Date.now() / 1000);
      const filename = `${timestamp}.jpg`;
      const repoImagePath = `public/images/${finalShortCode}/${filename}`;
      const browserImagePath = `images/${finalShortCode}/${filename}`;
      const id = `${finalShortCode}-${timestamp}`;

      const base64Image = arrayBufferToBase64(imageBytes);
      await commitFile(
        env,
        repoImagePath,
        base64Image,
        `Add photo: ${finalShortCode} [skip-deploy]`
      );

      const entry: PicEntry = {
        seq,
        id,
        shortCode: finalShortCode,
        zoneCode: resolvedPic.zoneCode,
        tags: resolvedPic.tags,
        description: resolvedPic.description,
        image: browserImagePath,
        postedBy,
        addedAt: new Date().toISOString(),
        width: photo.width,
        height: photo.height,

      };

      const plantUpsertRecord: PlantRecord | null = plantUpsert
        ? {
            shortCode: plantUpsert.shortCode,
            fullName: plantUpsert.fullName,
            commonName: plantUpsert.commonName,
            variety: plantUpsert.variety,
          }
        : null;

      await appendPic(env, entry, plantUpsertRecord, zoneUpserts);

      if (annotationTags.plantTags.length > 0) {
        await upsertAnnotation(env, finalShortCode, null, "tags", annotationTags.plantTags.join(","));
      }
      if (annotationTags.zoneTags.length > 0) {
        await upsertAnnotation(env, finalShortCode, resolvedPic.zoneCode, "tags", annotationTags.zoneTags.join(","));
      }

      const mergedZones = [...gallery.zones];
      for (const u of zoneUpserts) {
        const idx = mergedZones.findIndex((z) => z.code === u.code);
        if (idx === -1) mergedZones.push(u);
        else mergedZones[idx] = { ...mergedZones[idx], name: u.name ?? mergedZones[idx].name };
      }
      const resolvedZone = mergedZones.find((z) => z.code === resolvedPic.zoneCode);
      const zoneLabel = resolvedZone?.name
        ? `${resolvedZone.name} (${resolvedPic.zoneCode})`
        : resolvedPic.zoneCode;

      const plantForReply =
        plantUpsertRecord ??
        gallery.plants.find((p) => p.shortCode === finalShortCode) ??
        null;

      const lines = [
        `Added pic #${seq}: ${finalShortCode}`,
        isUnidentified
          ? `  Unidentified — /accept ${seq} once BioCLIP runs, or /update to set fields manually`
          : null,
        plantForReply?.commonName ? `  Common: ${plantForReply.commonName}` : null,
        plantForReply?.variety ? `  Variety: '${plantForReply.variety}'` : null,
        plantForReply?.fullName ? `  Full: ${plantForReply.fullName}` : null,
        `  Zone: ${zoneLabel}`,
        resolvedPic.tags.length > 0 ? `  Tags: ${resolvedPic.tags.join(", ")}` : null,
        annotationTags.zoneTags.length > 0 ? `  Zone tags: ${annotationTags.zoneTags.join(", ")}` : null,
        annotationTags.plantTags.length > 0 ? `  Plant tags: ${annotationTags.plantTags.join(", ")}` : null,
        resolvedPic.description ? `  Note: ${resolvedPic.description}` : null,
        `  → ${browserImagePath}`,
      ].filter(Boolean);

      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        lines.join("\n")
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        `Error: ${errorMessage}`
      );
    }

    return new Response("OK");
  },

  async scheduled(
    _event: { cron?: string; scheduledTime?: number },
    env: Env,
    ctx: { waitUntil: (p: Promise<unknown>) => void }
  ): Promise<void> {
    ctx.waitUntil(
      processAnalyzeTick(env)
        .then((r) => {
          if (r.ranTick) {
            console.log(
              `[analyze.cron] processed=${r.processed} succeeded=${r.succeeded} failed=${r.failed} remaining=${r.remaining}`
            );
          }
        })
        .catch((err) => {
          console.log(`[analyze.cron] tick failed: ${(err as Error).message}`);
        })
    );
  },
};
