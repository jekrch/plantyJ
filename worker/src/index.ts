import type { Env, PlantEntry, TelegramUpdate } from "./types";
import { parseCaption, resolveFields } from "./caption";
import { downloadFile, sendReply } from "./telegram";
import {
  appendPlant,
  arrayBufferToBase64,
  commitFile,
  deletePlant,
  isUpdatableField,
  nextSeq,
  readPlantsJson,
  updatePlant,
} from "./github";

const HELP_HEADER = `PlantyJ Bot — Commands:

Add a plant photo:
  Post a photo with a caption in this format (only shortCode is required):
  shortCode // fullName // commonName // Zone Name (zoneCode) // tags // description

  First time registering a plant + zone:
  tmt-c // Solanum lycopersicum 'Cherokee Purple' // Cherokee Purple Tomato // Front Bed 1 (fb1) // edible,heirloom // first ripe fruit

  Once shortCode and zone are known, just:
  tmt-c // // // fb1 // // sizing up nicely

  If the plant hasn't moved zones, just the code is enough:
  tmt-c

Commands:
  /delete {seq} — Remove a plant entry by its sequential ID
  /update {seq} {field} {value} — Update a field on a plant
  /help — Show this message

Updatable fields: shortCode, fullName, commonName, zoneCode, zoneName, tags, description`;

function buildHelpText(plants: PlantEntry[]): string {
  const plantMap = new Map<string, string>();
  const zoneMap = new Map<string, string>();
  for (const p of plants) {
    if (!plantMap.has(p.shortCode)) {
      plantMap.set(p.shortCode, p.commonName ?? p.fullName ?? p.shortCode);
    }
    if (!zoneMap.has(p.zoneCode)) {
      zoneMap.set(p.zoneCode, p.zoneName ?? p.zoneCode);
    }
  }

  
  const sections: string[] = [HELP_HEADER];

  if (plantMap.size > 0) {
    const lines = Array.from(plantMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, name]) => `  ${code} — ${name}`);
    sections.push(`Known plants:\n${lines.join("\n")}`);
  }

  if (zoneMap.size > 0) {
    const lines = Array.from(zoneMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, name]) => `  ${code} — ${name}`);
    sections.push(`Known zones:\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
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
            buildHelpText(gallery.plants)
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
              `Invalid field "${field}". Updatable: shortCode, fullName, commonName, zoneCode, zoneName, tags, description`
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
        "Photo received but no caption.\n\nFormat:\nshortCode // fullName // commonName // Zone (code) // tags // description"
      );
      return new Response("OK");
    }

    if (!message.photo || !message.caption) return new Response("OK");

    try {
      const parsed = parseCaption(message.caption);

      const { gallery } = await readPlantsJson(env);
      const resolved = resolveFields(parsed, gallery.plants);

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
        zoneName: resolved.zoneName,
        tags: resolved.tags,
        description: resolved.description,
        image: browserImagePath,
        postedBy,
        addedAt: new Date().toISOString(),
      };
      await appendPlant(env, entry);

      const lines = [
        `Added plant #${seq}: ${resolved.shortCode}`,
        resolved.commonName ? `  Common: ${resolved.commonName}` : null,
        resolved.fullName ? `  Full: ${resolved.fullName}` : null,
        `  Zone: ${resolved.zoneName ?? resolved.zoneCode} (${resolved.zoneCode})`,
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
