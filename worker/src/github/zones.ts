import type { Env, Zone, ZonePicEntry } from "../types";
import { deleteFileIfExists, writeJsonFile } from "./client";
import { applyZoneUpserts, readGallery } from "./gallery";
import { ZONE_PICS_PATH, ZONES_PATH } from "./paths";

export async function upsertZone(env: Env, code: string, name: string | null): Promise<Zone> {
  const { gallery, zonesSha } = await readGallery(env);
  const idx = gallery.zones.findIndex((z) => z.code === code);
  let zone: Zone;
  let action: string;
  if (idx === -1) {
    zone = { code, name };
    gallery.zones.push(zone);
    action = "Add";
  } else {
    zone = { ...gallery.zones[idx], name };
    gallery.zones[idx] = zone;
    action = "Rename";
  }
  await writeJsonFile(
    env,
    ZONES_PATH,
    { zones: gallery.zones },
    zonesSha,
    `${action} zone: ${code}`,
  );
  return zone;
}

export async function setZoneDescription(
  env: Env,
  code: string,
  description: string | null,
): Promise<Zone> {
  const { gallery, zonesSha } = await readGallery(env);
  const idx = gallery.zones.findIndex((z) => z.code === code);
  let zone: Zone;
  if (idx === -1) {
    zone = { code, name: null };
  } else {
    zone = { ...gallery.zones[idx] };
  }
  if (description) zone.description = description;
  else delete zone.description;
  if (idx === -1) gallery.zones.push(zone);
  else gallery.zones[idx] = zone;
  await writeJsonFile(
    env,
    ZONES_PATH,
    { zones: gallery.zones },
    zonesSha,
    `${description ? "Set" : "Clear"} zone description: ${code}`,
  );
  return zone;
}

export async function appendZonePic(
  env: Env,
  newZonePic: ZonePicEntry,
  zoneUpsert: Zone | null,
): Promise<void> {
  const { gallery, zonesSha, zonePicsSha } = await readGallery(env);

  if (zoneUpsert) {
    const nextZones = applyZoneUpserts(gallery.zones, [zoneUpsert]);
    await writeJsonFile(
      env,
      ZONES_PATH,
      { zones: nextZones },
      zonesSha,
      `Add zone: ${zoneUpsert.code}`,
    );
  }

  const nextZonePics = [newZonePic, ...gallery.zonePics];
  await writeJsonFile(
    env,
    ZONE_PICS_PATH,
    { zonePics: nextZonePics },
    zonePicsSha,
    `Add zone pic: ${newZonePic.zoneCode}`,
  );
}

export async function deleteZonePic(env: Env, id: string): Promise<ZonePicEntry | null> {
  const { gallery, zonePicsSha } = await readGallery(env);
  const idx = gallery.zonePics.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const [removed] = gallery.zonePics.splice(idx, 1);

  await writeJsonFile(
    env,
    ZONE_PICS_PATH,
    { zonePics: gallery.zonePics },
    zonePicsSha,
    `Remove zone pic: ${removed.zoneCode} (${removed.id})`,
  );

  await deleteFileIfExists(
    env,
    `public/${removed.image}`,
    `Delete zone image: ${removed.zoneCode} (${removed.id})`,
  );

  return removed;
}

export interface DeleteZoneResult {
  zone: Zone | null;
  inUseBy: string[];
}

export async function deleteZone(env: Env, code: string): Promise<DeleteZoneResult> {
  const { gallery, zonesSha } = await readGallery(env);
  const idx = gallery.zones.findIndex((z) => z.code === code);
  if (idx === -1) return { zone: null, inUseBy: [] };

  const inUseBy = gallery.pics.filter((p) => p.zoneCode === code).map((p) => p.shortCode);
  const zonePicsInUse = gallery.zonePics.filter((p) => p.zoneCode === code);
  if (zonePicsInUse.length > 0) {
    inUseBy.push(`${zonePicsInUse.length} zone pic(s)`);
  }
  if (inUseBy.length > 0) {
    return { zone: gallery.zones[idx], inUseBy };
  }

  const [removed] = gallery.zones.splice(idx, 1);
  await writeJsonFile(env, ZONES_PATH, { zones: gallery.zones }, zonesSha, `Remove zone: ${code}`);
  return { zone: removed, inUseBy: [] };
}
