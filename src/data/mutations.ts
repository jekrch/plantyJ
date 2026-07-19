import type { OrganismRecord, PicMetadata, PicRecord, Zone } from "../types";
import { DRIVE_IMAGE_PREFIX, isWritable, loadJson, notifyDataChanged } from "./source";
import { driveDeleteImage, driveSaveJson, driveUploadImage } from "./driveSource";
import { getSessionUser } from "./googleAuth";
import { resizeImage } from "../utils/resizeImage";
import { assertValidCode } from "../lib/journal/validation";
import { computeImageMetadata } from "../lib/journal/imageMetadata";

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
interface MetadataFile {
  picMetadata?: PicMetadata[];
}

export async function addEntries(
  inputs: NewEntryInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  assertWritable();
  for (const input of inputs) {
    assertValidCode("plant code", input.shortCode);
    assertValidCode("zone code", input.zoneCode);
  }
  const [picsFile, plantsFile, zonesFile, metaFile] = await Promise.all([
    loadJson<PicsFile>("pics.json"),
    loadJson<{ plants?: OrganismRecord[] }>("plants.json"),
    loadJson<{ zones?: Zone[] }>("zones.json"),
    loadJson<MetadataFile>("pic-metadata.json"),
  ]);
  const pics = picsFile.pics ?? [];
  const plants = plantsFile.plants ?? [];
  const zones = zonesFile.zones ?? [];
  const picMetadata = metaFile.picMetadata ?? [];

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
    // Perceptual hash + dominant colors, mirroring the Actions pipeline so the
    // duplicate/color sorts work on Drive gardens too.
    const meta = await computeImageMetadata(blob);
    const ts = Math.max(lastTs + 1, Math.floor(Date.now() / 1000));
    lastTs = ts;
    const fileId = await driveUploadImage(`${input.shortCode}-${ts}.jpg`, blob);
    const id = `${input.shortCode}-${ts}`;

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
      id,
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
    picMetadata.push({ id, phash: meta.phash, dominantColors: meta.dominantColors });
    onProgress?.(++done, inputs.length);
  }

  await driveSaveJson("pics.json", { pics });
  await driveSaveJson("pic-metadata.json", { picMetadata });
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
    assertValidCode("zone code", fields.zoneCode);
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
  const [picsFile, metaFile] = await Promise.all([
    loadJson<PicsFile>("pics.json"),
    loadJson<MetadataFile>("pic-metadata.json"),
  ]);
  const pics = picsFile.pics ?? [];
  const pic = pics.find((p) => p.id === id);
  if (!pic) return;

  await driveSaveJson("pics.json", { pics: pics.filter((p) => p.id !== id) });
  const picMetadata = (metaFile.picMetadata ?? []).filter((m) => m.id !== id);
  await driveSaveJson("pic-metadata.json", { picMetadata });
  if (pic.image.startsWith(DRIVE_IMAGE_PREFIX)) {
    await driveDeleteImage(pic.image.slice(DRIVE_IMAGE_PREFIX.length)).catch(() => {
      // The journal entry is gone; a stray image file is harmless.
    });
  }
  notifyDataChanged();
}

/** Rename a zone / edit its description. Zone code is the immutable key. */
export async function updateZone(
  code: string,
  fields: { name?: string | null; description?: string | null },
): Promise<void> {
  assertWritable();
  const zonesFile = await loadJson<{ zones?: Zone[] }>("zones.json");
  const zones = zonesFile.zones ?? [];
  const zone = zones.find((z) => z.code === code);
  if (!zone) throw new Error(`Zone not found: ${code}`);
  if (fields.name !== undefined) zone.name = fields.name;
  if (fields.description !== undefined) zone.description = fields.description;
  await driveSaveJson("zones.json", { zones });
  notifyDataChanged();
}
