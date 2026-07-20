import type { Env, Gallery, PicEntry, PlantRecord, Zone, ZonePicEntry } from "../types";
import { deleteFileIfExists, readJsonFile, writeJsonFile } from "./client";
import { PICS_PATH, PLANTS_PATH, ZONE_PICS_PATH, ZONES_PATH } from "./paths";

export interface ReadResult {
  gallery: Gallery;
  picsSha: string | null;
  plantsSha: string | null;
  zonesSha: string | null;
  zonePicsSha: string | null;
}

export async function readGallery(env: Env): Promise<ReadResult> {
  const [picsRes, plantsRes, zonesRes, zonePicsRes] = await Promise.all([
    readJsonFile<{ pics?: PicEntry[] }>(env, PICS_PATH, { pics: [] }),
    readJsonFile<{ plants?: PlantRecord[] }>(env, PLANTS_PATH, { plants: [] }),
    readJsonFile<{ zones?: Zone[] }>(env, ZONES_PATH, { zones: [] }),
    readJsonFile<{ zonePics?: ZonePicEntry[] }>(env, ZONE_PICS_PATH, { zonePics: [] }),
  ]);

  return {
    gallery: {
      pics: picsRes.data.pics ?? [],
      plants: plantsRes.data.plants ?? [],
      zones: zonesRes.data.zones ?? [],
      zonePics: zonePicsRes.data.zonePics ?? [],
    },
    picsSha: picsRes.sha,
    plantsSha: plantsRes.sha,
    zonesSha: zonesRes.sha,
    zonePicsSha: zonePicsRes.sha,
  };
}

export function nextSeq(gallery: Gallery): number {
  let max = 0;
  for (const p of gallery.pics) {
    if (p.seq && p.seq > max) max = p.seq;
  }
  return max + 1;
}

/** Add unknown zones; for known ones only fill in a name, never blank it out. */
export function applyZoneUpserts(zones: Zone[], upserts: Zone[]): Zone[] {
  const next = [...zones];
  for (const u of upserts) {
    const idx = next.findIndex((z) => z.code === u.code);
    if (idx === -1) next.push(u);
    else next[idx] = { ...next[idx], name: u.name ?? next[idx].name };
  }
  return next;
}

/** New plants go to the front (newest first); existing ones are replaced. */
export function upsertPlantRecord(plants: PlantRecord[], upsert: PlantRecord): PlantRecord[] {
  const next = [...plants];
  const idx = next.findIndex((p) => p.shortCode === upsert.shortCode);
  if (idx === -1) next.unshift(upsert);
  else next[idx] = upsert;
  return next;
}

export async function appendPic(
  env: Env,
  newPic: PicEntry,
  plantUpsert: PlantRecord | null,
  zoneUpserts: Zone[] = [],
): Promise<void> {
  const { gallery, picsSha, plantsSha, zonesSha } = await readGallery(env);

  if (zoneUpserts.length > 0) {
    const nextZones = applyZoneUpserts(gallery.zones, zoneUpserts);
    await writeJsonFile(
      env,
      ZONES_PATH,
      { zones: nextZones },
      zonesSha,
      `Add zone(s): ${zoneUpserts.map((z) => z.code).join(", ")}`,
    );
  }

  if (plantUpsert) {
    const nextPlants = upsertPlantRecord(gallery.plants, plantUpsert);
    await writeJsonFile(
      env,
      PLANTS_PATH,
      { plants: nextPlants },
      plantsSha,
      `Add/update plant: ${plantUpsert.shortCode} [skip-deploy]`,
    );
  }

  const nextPics = [newPic, ...gallery.pics];
  await writeJsonFile(
    env,
    PICS_PATH,
    { pics: nextPics },
    picsSha,
    `Add pic: ${newPic.shortCode} [skip-deploy]`,
  );
}

export async function deletePic(env: Env, seq: number): Promise<PicEntry | null> {
  const { gallery, picsSha } = await readGallery(env);
  const idx = gallery.pics.findIndex((p) => p.seq === seq);
  if (idx === -1) return null;

  const [removed] = gallery.pics.splice(idx, 1);

  await writeJsonFile(
    env,
    PICS_PATH,
    { pics: gallery.pics },
    picsSha,
    `Remove pic: ${removed.shortCode} (#${removed.seq})`,
  );

  await deleteFileIfExists(
    env,
    `public/${removed.image}`,
    `Delete image: ${removed.shortCode} (#${removed.seq})`,
  );

  return removed;
}

export async function addPicTag(env: Env, seq: number, tag: string): Promise<PicEntry | null> {
  const { gallery, picsSha } = await readGallery(env);
  const pic = gallery.pics.find((p) => p.seq === seq);
  if (!pic) return null;
  if (pic.tags.includes(tag)) return pic;
  pic.tags = [...pic.tags, tag];
  await writeJsonFile(
    env,
    PICS_PATH,
    { pics: gallery.pics },
    picsSha,
    `Add tag to pic #${seq}: ${tag}`,
  );
  return pic;
}

export async function removePicTag(
  env: Env,
  seq: number,
  tag: string,
): Promise<{ pic: PicEntry; removed: boolean } | null> {
  const { gallery, picsSha } = await readGallery(env);
  const pic = gallery.pics.find((p) => p.seq === seq);
  if (!pic) return null;
  if (!pic.tags.includes(tag)) return { pic, removed: false };
  pic.tags = pic.tags.filter((t) => t !== tag);
  await writeJsonFile(
    env,
    PICS_PATH,
    { pics: gallery.pics },
    picsSha,
    `Remove tag from pic #${seq}: ${tag}`,
  );
  return { pic, removed: true };
}
