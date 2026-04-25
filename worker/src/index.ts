import type { Env, Gallery, PlantEntry, TelegramUpdate, Zone } from "./types";
import { parseCaption, resolveFields } from "./caption";
import { downloadFile, sendReply } from "./telegram";
import {
  appendPlant,
  arrayBufferToBase64,
  commitFile,
  deletePlant,
  deleteZone,
  isUpdatableField,
  nextSeq,
  readPlantsJson,
  updatePlant,
  upsertZone,
} from "./github";

const HELP_HEADER = `PlantyJ Bot — Commands:

Add a plant photo:
  Each photo is one plant in one zone. If a plant lives in multiple zones,
  post a separate photo per zone.

  Caption format (only shortCode is required):
  shortCode // fullName // commonName // zone // tags // description

  Zone is either a bare code (fb1) or 'Display Name (code)' to declare/rename.

  First time registering a plant + zone:
  tmt-c // Solanum lycopersicum 'Cherokee Purple' // Cherokee Purple Tomato // Front Bed 1 (fb1) // edible,heirloom // first ripe fruit

  Same plant photographed in a different zone (just supply the new zone):
  mint-1 // // // sb // // spreading into the side bed

  Once shortCode and zone are known, just:
  tmt-c // // // fb1 // // sizing up nicely

  If posting from the same zone as the last photo of this plant, just the code:
  tmt-c

Plant commands:
  /delete {seq} — Remove a plant entry by its sequential ID
  /update {seq} {field} {value} — Update a field on a plant
  /help — Show this message

Updatable fields: shortCode, fullName, commonName, zoneCode, tags, description
  (zoneCode is a single zone, e.g. /update 12 zoneCode sb)

Zone commands:
  /addzone {code} {name} — Create or rename a zone (name optional)
  /renamezone {code} {name} — Set/replace a zone's display name
  /deletezone {code} — Remove a zone (only if no plants reference it)
  /zones — List all known zones`;

function buildHelpText(gallery: Gallery): string {
  const plantMap = new Map<string, string>();
  for (const p of gallery.plants) {
    if (!plantMap.has(p.shortCode)) {
      plantMap.set(p.shortCode, p.commonName ?? p.fullName ?? p.shortCode);
    }
  }

  const sections: string[] = [HELP_HEADER];

  if (plantMap.size > 0) {
    const lines = Array.from(plantMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, name]) => `  ${code} — ${name}`);
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
          const { gallery } = await readPlantsJson(env);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            buildHelpText(gallery)
          );
          return new Response("OK");
        }

        if (text === "/zones") {
          const { gallery } = await readPlantsJson(env);
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
          const removed = await deletePlant(env, seq);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            removed
              ? `Deleted plant #${seq}: ${removed.shortCode}`
              : `No plant found with ID ${seq}.`
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

          const updated = await updatePlant(env, seq, field, value);
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            updated
              ? `Updated plant #${seq}: ${field} → "${value}"\n→ ${updated.shortCode}`
              : `No plant found with ID ${seq}.`
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
        "Photo received but no caption.\n\nFormat:\nshortCode // fullName // commonName // zones // tags // description"
      );
      return new Response("OK");
    }

    if (!message.photo || !message.caption) return new Response("OK");

    try {
      const parsed = parseCaption(message.caption);

      const { gallery } = await readPlantsJson(env);
      const { plant: resolved, zoneUpserts } = resolveFields(
        parsed,
        gallery.plants,
        gallery.zones
      );

      const postedBy =
        message.from?.first_name || message.from?.username || "unknown";

      const photo = message.photo[message.photo.length - 1];
      const imageBytes = await downloadFile(photo.file_id, env.TELEGRAM_BOT_TOKEN);

      const timestamp = Math.floor(Date.now() / 1000);
      const filename = `${timestamp}.jpg`;
      const repoImagePath = `public/images/${resolved.shortCode}/${filename}`;
      const browserImagePath = `images/${resolved.shortCode}/${filename}`;
      const id = `${resolved.shortCode}-${timestamp}`;

      const base64Image = arrayBufferToBase64(imageBytes);
      await commitFile(
        env,
        repoImagePath,
        base64Image,
        `Add photo: ${resolved.shortCode}`
      );

      const seq = nextSeq(gallery);

      const entry: PlantEntry = {
        seq,
        id,
        shortCode: resolved.shortCode,
        fullName: resolved.fullName,
        commonName: resolved.commonName,
        zoneCode: resolved.zoneCode,
        tags: resolved.tags,
        description: resolved.description,
        image: browserImagePath,
        postedBy,
        addedAt: new Date().toISOString(),
      };
      await appendPlant(env, entry, zoneUpserts);

      const mergedZones = [...gallery.zones];
      for (const u of zoneUpserts) {
        const idx = mergedZones.findIndex((z) => z.code === u.code);
        if (idx === -1) mergedZones.push(u);
        else mergedZones[idx] = { ...mergedZones[idx], name: u.name ?? mergedZones[idx].name };
      }
      const resolvedZone = mergedZones.find((z) => z.code === resolved.zoneCode);
      const zoneLabel = resolvedZone?.name
        ? `${resolvedZone.name} (${resolved.zoneCode})`
        : resolved.zoneCode;

      const lines = [
        `Added plant #${seq}: ${resolved.shortCode}`,
        resolved.commonName ? `  Common: ${resolved.commonName}` : null,
        resolved.fullName ? `  Full: ${resolved.fullName}` : null,
        `  Zone: ${zoneLabel}`,
        resolved.tags.length > 0 ? `  Tags: ${resolved.tags.join(", ")}` : null,
        resolved.description ? `  Note: ${resolved.description}` : null,
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
