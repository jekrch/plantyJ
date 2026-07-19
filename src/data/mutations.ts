import type { OrganismRecord, PicRecord, Zone } from "../types";
import { DRIVE_IMAGE_PREFIX, isWritable, loadJson, notifyDataChanged } from "./source";
import { driveDeleteImage, driveSaveJson, driveUploadImage } from "./driveSource";
import { getSessionUser } from "./googleAuth";
import { resizeImage } from "../utils/resizeImage";

/**
 * Write path for Drive-backed gardens. Each mutation re-reads the affected
 * bundles from Drive before writing (cheap read-modify-write; a concurrent
 * edit from another device loses only if it lands mid-flight).
 */

export interface NewEntryInput {
  file: File;
  shortCode: string;
  /** Names for a plant not yet in plants.json. */
  newPlant?: { fullName: string | null; commonName: string | null; variety: string | null };
  zoneCode: string;
  /** Display name for a zone not yet in zones.json. */
  newZoneName?: string;
  tags: string[];
  description: string | null;
}

export interface EntryUpdate {
  zoneCode?: string;
  tags?: string[];
  description?: string | null;
}

function assertWritable(): void {
  if (!isWritable()) throw new Error("The demo garden is read-only");
}

interface PicsFile {
  pics?: PicRecord[];
}

export async function addEntries(
  inputs: NewEntryInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  assertWritable();
  const [picsFile, plantsFile, zonesFile] = await Promise.all([
    loadJson<PicsFile>("pics.json"),
    loadJson<{ plants?: OrganismRecord[] }>("plants.json"),
    loadJson<{ zones?: Zone[] }>("zones.json"),
  ]);
  const pics = picsFile.pics ?? [];
  const plants = plantsFile.plants ?? [];
  const zones = zonesFile.zones ?? [];

  let nextSeq = pics.reduce((m, p) => Math.max(m, p.seq), 0) + 1;
  // Unix-seconds timestamps double as ids; keep them strictly increasing so a
  // multi-file batch never collides within one second.
  let lastTs = 0;
  const postedBy = getSessionUser()?.name.split(" ")[0] || "Me";
  let plantsChanged = false;
  let zonesChanged = false;
  let done = 0;

  for (const input of inputs) {
    const { blob, width, height } = await resizeImage(input.file);
    const ts = Math.max(lastTs + 1, Math.floor(Date.now() / 1000));
    lastTs = ts;
    const fileId = await driveUploadImage(`${input.shortCode}-${ts}.jpg`, blob);

    if (!plants.some((p) => p.shortCode === input.shortCode)) {
      plants.push({
        shortCode: input.shortCode,
        fullName: input.newPlant?.fullName ?? null,
        commonName: input.newPlant?.commonName ?? null,
        variety: input.newPlant?.variety ?? null,
      });
      plantsChanged = true;
    }
    if (!zones.some((z) => z.code === input.zoneCode)) {
      zones.push({ code: input.zoneCode, name: input.newZoneName || input.zoneCode });
      zonesChanged = true;
    }

    pics.unshift({
      seq: nextSeq++,
      id: `${input.shortCode}-${ts}`,
      shortCode: input.shortCode,
      zoneCode: input.zoneCode,
      tags: input.tags,
      description: input.description,
      image: `${DRIVE_IMAGE_PREFIX}${fileId}`,
      postedBy,
      addedAt: new Date().toISOString(),
      width,
      height,
    });
    onProgress?.(++done, inputs.length);
  }

  await driveSaveJson("pics.json", { pics });
  if (plantsChanged) await driveSaveJson("plants.json", { plants });
  if (zonesChanged) await driveSaveJson("zones.json", { zones });
  notifyDataChanged();
}

export async function updateEntry(id: string, fields: EntryUpdate): Promise<void> {
  assertWritable();
  const picsFile = await loadJson<PicsFile>("pics.json");
  const pics = picsFile.pics ?? [];
  const pic = pics.find((p) => p.id === id);
  if (!pic) throw new Error(`Entry not found: ${id}`);

  if (fields.zoneCode !== undefined && fields.zoneCode !== pic.zoneCode) {
    const zonesFile = await loadJson<{ zones?: Zone[] }>("zones.json");
    const zones = zonesFile.zones ?? [];
    if (!zones.some((z) => z.code === fields.zoneCode)) {
      zones.push({ code: fields.zoneCode, name: fields.zoneCode });
      await driveSaveJson("zones.json", { zones });
    }
    pic.zoneCode = fields.zoneCode;
  }
  if (fields.tags !== undefined) pic.tags = fields.tags;
  if (fields.description !== undefined) pic.description = fields.description;

  await driveSaveJson("pics.json", { pics });
  notifyDataChanged();
}

export async function deleteEntry(id: string): Promise<void> {
  assertWritable();
  const picsFile = await loadJson<PicsFile>("pics.json");
  const pics = picsFile.pics ?? [];
  const pic = pics.find((p) => p.id === id);
  if (!pic) return;

  await driveSaveJson("pics.json", { pics: pics.filter((p) => p.id !== id) });
  if (pic.image.startsWith(DRIVE_IMAGE_PREFIX)) {
    await driveDeleteImage(pic.image.slice(DRIVE_IMAGE_PREFIX.length)).catch(() => {
      // The journal entry is gone; a stray image file is harmless.
    });
  }
  notifyDataChanged();
}
