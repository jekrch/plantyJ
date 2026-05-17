import type { Env, PicEntry, PlantRecord, TelegramMessage, TelegramPhotoSize, Zone, ZonePicEntry } from "./types";
import { downloadFile, type Replier } from "./telegram";
import { parseCaption, resolveFields, UNIDENTIFIED_CODE, UNIDENTIFIED_PREFIX } from "./caption";
import { assertValidCode } from "./validation";
import {
  appendPic,
  appendZonePic,
  arrayBufferToBase64,
  commitFile,
  nextSeq,
  readGallery,
  upsertAnnotation,
} from "./github";

const NO_CAPTION_HELP =
  "Photo received but no caption.\n\n" +
  "Format:\nshortCode // fullName // commonName // zones // tags // description\n\n" +
  "Or for a zone photo:\n/zonepic {zoneCode} [// description]";

interface UploadedImage {
  browserPath: string;
  id: string;
}

/** Download from Telegram and commit to GitHub at `public/<repoSubpath>/<timestamp>.jpg`. */
async function uploadImage(
  env: Env,
  photo: TelegramPhotoSize,
  repoSubpath: string,
  idPrefix: string,
  commitMessage: string
): Promise<UploadedImage> {
  const imageBytes = await downloadFile(photo.file_id, env.TELEGRAM_BOT_TOKEN);
  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `${timestamp}.jpg`;
  const repoPath = `public/${repoSubpath}/${filename}`;
  const browserPath = `${repoSubpath}/${filename}`;
  const base64 = arrayBufferToBase64(imageBytes);
  await commitFile(env, repoPath, base64, commitMessage);
  return { browserPath, id: `${idPrefix}-${timestamp}` };
}

function postedByOf(message: TelegramMessage): string {
  return message.from?.first_name || message.from?.username || "unknown";
}

function joinLines(lines: (string | null | false | undefined)[]): string {
  return lines.filter(Boolean).join("\n");
}

async function handleZonePic(
  zoneCode: string,
  description: string | null,
  message: TelegramMessage,
  env: Env,
  reply: Replier
): Promise<void> {
  const { gallery } = await readGallery(env);
  const existingZone = gallery.zones.find((z) => z.code === zoneCode);
  const zoneUpsert: Zone | null = existingZone ? null : { code: zoneCode, name: null };

  const photo = message.photo![message.photo!.length - 1];
  const { browserPath, id } = await uploadImage(
    env,
    photo,
    `images/zones/${zoneCode}`,
    zoneCode,
    `Add zone photo: ${zoneCode}`
  );

  const entry: ZonePicEntry = {
    id,
    zoneCode,
    image: browserPath,
    addedAt: new Date().toISOString(),
    postedBy: postedByOf(message),
    description,
  };
  await appendZonePic(env, entry, zoneUpsert);

  const zoneLabel = existingZone?.name ? `${existingZone.name} (${zoneCode})` : zoneCode;
  await reply(
    joinLines([
      `Added zone pic for ${zoneLabel}`,
      `  id: ${id}`,
      description ? `  Note: ${description}` : null,
      `  → ${browserPath}`,
    ])
  );
}

async function handlePlantPic(message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  const parsed = parseCaption(message.caption!);
  const { gallery } = await readGallery(env);
  const { pic: resolvedPic, plantUpsert, zoneUpserts, annotationTags } = resolveFields(
    parsed,
    gallery.pics,
    gallery.plants,
    gallery.zones
  );

  const seq = nextSeq(gallery);
  const isUnidentified = resolvedPic.shortCode === UNIDENTIFIED_CODE;
  const finalShortCode = isUnidentified ? `${UNIDENTIFIED_PREFIX}${seq}` : resolvedPic.shortCode;

  const photo = message.photo![message.photo!.length - 1];
  const { browserPath, id } = await uploadImage(
    env,
    photo,
    `images/${finalShortCode}`,
    finalShortCode,
    `Add photo: ${finalShortCode} [skip-deploy]`
  );

  const entry: PicEntry = {
    seq,
    id,
    shortCode: finalShortCode,
    zoneCode: resolvedPic.zoneCode,
    tags: resolvedPic.tags,
    description: resolvedPic.description,
    image: browserPath,
    postedBy: postedByOf(message),
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

  // Resolve final zone label using merged upserts so newly-declared zones display correctly.
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
    plantUpsertRecord ?? gallery.plants.find((p) => p.shortCode === finalShortCode) ?? null;

  await reply(
    joinLines([
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
      `  → ${browserPath}`,
    ])
  );
}

/**
 * Handle any photo message. Returns true if the message was a photo (handled
 * or rejected with help text), false if it had no photo at all.
 */
export async function handlePhotoMessage(
  message: TelegramMessage,
  env: Env,
  reply: Replier
): Promise<boolean> {
  if (!message.photo) return false;

  if (!message.caption) {
    await reply(NO_CAPTION_HELP);
    return true;
  }

  try {
    const caption = message.caption.trim();
    const zonePicMatch = caption.match(/^\/zonepic\s+(\S+)(?:\s*\/\/\s*(\S[\s\S]*))?$/);
    if (zonePicMatch) {
      assertValidCode("zoneCode", zonePicMatch[1]);
      await handleZonePic(zonePicMatch[1], zonePicMatch[2]?.trim() || null, message, env, reply);
    } else {
      await handlePlantPic(message, env, reply);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await reply(`Error: ${msg}`);
  }
  return true;
}
