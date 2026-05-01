import type { Env, Gallery, PicEntry, PlantRecord, TelegramUpdate, Zone, ZonePicEntry } from "./types";
import { parseCaption, resolveFields, UNIDENTIFIED_CODE, UNIDENTIFIED_PREFIX } from "./caption";
import { downloadFile, sendReply } from "./telegram";
import {
  acceptBioclip,
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
  readGallery,
  updateBySeq,
  upsertAnnotation,
  upsertZone,
} from "./github";

const HELP_HEADER = `PlantyJ Bot — Commands:

Add a plant photo:
  Each photo is one plant in one zone. If a plant lives in multiple zones,
  post a separate photo per zone.

  Caption format (only shortCode is required):
  shortCode // fullName // commonName // zone // tags // description

  To add an animal photo (squirrel, butterfly, etc.), prefix with "animal //":
  animal // shortCode // fullName // commonName // zone // tags // description

  Zone is either a bare code (fb1) or 'Display Name (code)' to declare/rename.

  First time registering a plant + zone:
  tmt-c // Solanum lycopersicum 'Cherokee Purple' // Cherokee Purple Tomato // Front Bed 1 (fb1) // edible,heirloom // first ripe fruit

  Same plant photographed in a different zone (just supply the new zone):
  mint-1 // // // sb // // spreading into the side bed

  Once shortCode and zone are known, just:
  tmt-c // // // fb1 // // sizing up nicely

  If posting from the same zone as the last photo of this plant, just the code:
  tmt-c

Unidentified plants:
  Don't know what it is? Use shortCode 'id':
  id // fb1                    — minimum: just a zone
  id // fb1 // mystery vine    — with a description
  The pic is saved as 'unid-{seq}' until you identify it. Once the BioCLIP
  action runs, accept its prediction with /accept, or fill it in manually
  with /update.

Pic commands:
  /delete {seq} — Remove a pic by its sequential ID
  /update {seq} {field} {value} — Update a field on a pic or its plant
  /accept {seq} [shortCode] — Apply BioCLIP prediction to an unidentified
    pic. With a shortCode, also rename (e.g. /accept 12 r-rub merges into
    an existing 'r-rub' plant or creates one).
  /help — Show this message

Updatable fields:
  Plant-level (apply to all pics of the plant): shortCode, fullName, commonName
  Pic-level (apply only to this pic): zoneCode, tags, description

Annotation commands (persistent across all pics):
  /annotate {shortCode} // tags // {tags} — set plant-level tags (comma-separated)
  /annotate {shortCode} // description // {desc} — set plant-level description
  /annotate {shortCode} // {zoneCode} // tags // {tags} — set plant+zone tags
  /annotate {shortCode} // {zoneCode} // description // {desc} — set plant+zone description
  /deleteannotation {shortCode} — remove plant-level annotation
  /deleteannotation {shortCode} // {zoneCode} — remove plant+zone annotation
  Set tags to "-" or leave value empty to clear.

Zone commands:
  /addzone {code} {name} — Create or rename a zone (name optional)
  /renamezone {code} {name} — Set/replace a zone's display name
  /deletezone {code} — Remove a zone (only if no pics reference it)
  /zones — List all known zones

Zone photo (represents the zone, not a plant):
  Send a photo with the caption:
  /zonepic {zoneCode} [// description]
  Zone pics live independently of plant pics and aren't grouped by shortCode.
  /deletezonepic {id} — Remove a zone pic by its id`;

function buildHelpText(gallery: Gallery): string {
  const sections: string[] = [HELP_HEADER];

  if (gallery.plants.length > 0) {
    const lines = [...gallery.plants]
      .sort((a, b) => a.shortCode.localeCompare(b.shortCode))
      .map((p) => `  ${p.shortCode} — ${p.commonName ?? p.fullName ?? p.shortCode}`);
    sections.push(`Known plants:\n${lines.join("\n")}`);
  }

  if (gallery.zones.length > 0) {
    const lines = [...gallery.zones]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((z) => `  ${z.code} — ${z.name ?? "(unnamed)"}`);
    sections.push(`Known zones:\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
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
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 403 });
    }

    const update: TelegramUpdate = await request.json();
    const message = update.message;

    if (!message) return new Response("OK");

    if (String(message.chat.id) !== env.TELEGRAM_ALLOWED_CHAT_ID) {
      return new Response("OK");
    }

    if (message.text) {
      const text = message.text.trim();

      try {
        if (text === "/help" || text === "/start") {
          const { gallery } = await readGallery(env);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            buildHelpText(gallery)
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
      const { pic: resolvedPic, plantUpsert, zoneUpserts } = resolveFields(
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
        `Add photo: ${finalShortCode}`
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
        ...(resolvedPic.kind === "animal" && { kind: "animal" }),
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
};
