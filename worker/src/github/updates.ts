import type { Env, PicEntry, PlantRecord } from "../types";
import { writeJsonFile } from "./client";
import { isPicField, isUpdatableField, parseList, UPDATABLE_FIELD_LIST } from "./fields";
import { readGallery } from "./gallery";
import { PICS_PATH, PLANTS_PATH, ZONES_PATH } from "./paths";

export interface UpdateResult {
  pic: PicEntry;
  plant: PlantRecord | null;
}

/**
 * Update a field on the pic with the given seq, or on its associated plant
 * record. shortCode rename cascades to all pics referencing the old code.
 */
export async function updateBySeq(
  env: Env,
  seq: number,
  field: string,
  value: string,
): Promise<UpdateResult | null> {
  if (!isUpdatableField(field)) {
    throw new Error(
      `Cannot update "${field}". Updatable fields: ${UPDATABLE_FIELD_LIST.join(", ")}`,
    );
  }

  const { gallery, picsSha, plantsSha, zonesSha } = await readGallery(env);
  const pic = gallery.pics.find((p) => p.seq === seq);
  if (!pic) return null;

  if (isPicField(field)) {
    switch (field) {
      case "zoneCode": {
        const code = value.trim();
        if (!code) throw new Error("zoneCode must be a non-empty zone code.");
        if (code.includes(",") || code.includes("+")) {
          throw new Error("zoneCode is a single value — a picture belongs to one zone.");
        }
        if (!gallery.zones.some((z) => z.code === code)) {
          const nextZones = [...gallery.zones, { code, name: null }];
          await writeJsonFile(env, ZONES_PATH, { zones: nextZones }, zonesSha, `Add zone: ${code}`);
        }
        pic.zoneCode = code;
        break;
      }
      case "tags":
        pic.tags = parseList(value);
        break;
      case "description":
        pic.description = value || null;
        break;
    }

    await writeJsonFile(
      env,
      PICS_PATH,
      { pics: gallery.pics },
      picsSha,
      `Update pic ${pic.shortCode} (#${pic.seq}): ${field}`,
    );

    const plant = gallery.plants.find((p) => p.shortCode === pic.shortCode) ?? null;
    return { pic, plant };
  }

  // Plant-level field — operate on the plant record keyed by pic.shortCode.
  const plantIdx = gallery.plants.findIndex((p) => p.shortCode === pic.shortCode);
  if (plantIdx === -1) {
    throw new Error(`Plant "${pic.shortCode}" not found in plants.json — cannot update ${field}.`);
  }
  const plant = gallery.plants[plantIdx];

  switch (field) {
    case "shortCode": {
      const newCode = value.trim();
      if (!newCode) throw new Error("shortCode must be non-empty.");
      if (newCode === plant.shortCode) {
        return { pic, plant };
      }
      if (gallery.plants.some((p) => p.shortCode === newCode)) {
        throw new Error(`shortCode "${newCode}" already exists.`);
      }
      const oldCode = plant.shortCode;
      plant.shortCode = newCode;
      // Cascade: re-point every pic that referenced the old code.
      for (const p of gallery.pics) {
        if (p.shortCode === oldCode) p.shortCode = newCode;
      }
      await writeJsonFile(
        env,
        PLANTS_PATH,
        { plants: gallery.plants },
        plantsSha,
        `Rename plant: ${oldCode} → ${newCode}`,
      );
      await writeJsonFile(
        env,
        PICS_PATH,
        { pics: gallery.pics },
        picsSha,
        `Re-point pics: ${oldCode} → ${newCode}`,
      );
      return { pic, plant };
    }
    case "fullName":
      plant.fullName = value || null;
      break;
    case "commonName":
      plant.commonName = value || null;
      break;
    case "variety":
      plant.variety = value || null;
      break;
  }

  await writeJsonFile(
    env,
    PLANTS_PATH,
    { plants: gallery.plants },
    plantsSha,
    `Update plant ${plant.shortCode}: ${field}`,
  );

  return { pic, plant };
}

export interface AcceptResult {
  pic: PicEntry;
  plant: PlantRecord;
  renamedFrom: string | null;
}

/**
 * Accept the BioCLIP prediction on a pic: ensure a plant record exists with
 * the predicted fullName/commonName, optionally renaming the pic's shortCode
 * (e.g. `unid-7` → `r-rub`). When merging into an existing plant record,
 * existing fields are preserved — never overwritten.
 */
export async function acceptBioclip(
  env: Env,
  seq: number,
  targetShortCode: string | null,
): Promise<AcceptResult | "no-pic" | "no-prediction"> {
  const { gallery, picsSha, plantsSha } = await readGallery(env);
  const pic = gallery.pics.find((p) => p.seq === seq);
  if (!pic) return "no-pic";

  const speciesId = pic.bioclipSpeciesId?.trim() || null;
  const commonName = pic.bioclipCommonName?.trim() || null;
  if (!speciesId && !commonName) return "no-prediction";

  const newCode = targetShortCode?.trim() || null;
  const oldCode = pic.shortCode;
  const finalCode = newCode ?? oldCode;

  let plantsChanged = false;
  let picsChanged = false;
  let renamedFrom: string | null = null;

  if (newCode && newCode !== oldCode) {
    renamedFrom = oldCode;
    for (const p of gallery.pics) {
      if (p.shortCode === oldCode) {
        p.shortCode = newCode;
        picsChanged = true;
      }
    }
    // If a plant record existed at the old (unidentified) code, drop it —
    // the meaningful record now lives at finalCode.
    const oldPlantIdx = gallery.plants.findIndex((p) => p.shortCode === oldCode);
    if (oldPlantIdx !== -1) {
      gallery.plants.splice(oldPlantIdx, 1);
      plantsChanged = true;
    }
  }

  const existingIdx = gallery.plants.findIndex((p) => p.shortCode === finalCode);
  let plant: PlantRecord;
  if (existingIdx === -1) {
    plant = {
      shortCode: finalCode,
      fullName: speciesId,
      commonName: commonName,
    };
    gallery.plants.unshift(plant);
    plantsChanged = true;
  } else {
    const existing = gallery.plants[existingIdx];
    const merged: PlantRecord = {
      shortCode: finalCode,
      fullName: existing.fullName ?? speciesId,
      commonName: existing.commonName ?? commonName,
    };
    if (merged.fullName !== existing.fullName || merged.commonName !== existing.commonName) {
      gallery.plants[existingIdx] = merged;
      plantsChanged = true;
    }
    plant = merged;
  }

  if (plantsChanged) {
    await writeJsonFile(
      env,
      PLANTS_PATH,
      { plants: gallery.plants },
      plantsSha,
      renamedFrom
        ? `Accept BioCLIP: ${renamedFrom} → ${finalCode}`
        : `Accept BioCLIP: ${finalCode}`,
    );
  }

  if (picsChanged) {
    await writeJsonFile(
      env,
      PICS_PATH,
      { pics: gallery.pics },
      picsSha,
      `Re-point pics: ${renamedFrom} → ${finalCode}`,
    );
  }

  return { pic, plant, renamedFrom };
}
