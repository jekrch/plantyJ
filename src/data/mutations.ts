import type {
  AIAnalysis,
  Annotation,
  OrganismRecord,
  PicMetadata,
  PicRecord,
  RelationshipsFile,
  Species,
  TaxaInfo,
  Zone,
  ZonePic,
} from "../types";
import { DRIVE_IMAGE_PREFIX, isWritable, loadJson, notifyDataChanged } from "./source";
import { driveDeleteImage, driveSaveJson, driveUploadImage } from "./driveSource";
import { getSessionUser } from "./googleAuth";
import { loadProfile } from "./profile";
import { resizeImage } from "../utils/resizeImage";
import { assertValidCode } from "../lib/journal/validation";
import { computeImageMetadata } from "../lib/journal/imageMetadata";
import { enrichGardenInBackground } from "./enrichment";
import { slugifyName } from "../hooks/useOrganismData";

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
  if (!isWritable()) throw new Error("The founder's garden is read-only");
}

/** Short author label for new entries: the account name, else the Google name. */
async function authorName(): Promise<string> {
  const profile = await loadProfile().catch(() => null);
  const name = profile?.name || getSessionUser()?.name || "Me";
  return name.split(" ")[0];
}

interface PicsFile {
  pics?: PicRecord[];
}
interface MetadataFile {
  picMetadata?: PicMetadata[];
}
interface AnnotationsFile {
  annotations?: Annotation[];
}
interface AnalysesFile {
  analyses?: AIAnalysis[];
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
  const postedBy = await authorName();
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

  // Kick off enrichment for the just-added photos (taxonomy, descriptions,
  // native range). Fire-and-forget: the pipeline is per-species idempotent and
  // its own failures must never surface as an upload error.
  enrichGardenInBackground();
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

/**
 * Delete an organism entirely: every journal entry under its shortCode (and the
 * uploaded images) plus all the data keyed to it — pic metadata, annotations, AI
 * analyses, and relationship edges. The species record is dropped too, but only
 * when no other plant still resolves to it (several shortCodes can share one
 * species entry via the name slug).
 */
export async function deleteOrganism(shortCode: string): Promise<void> {
  assertWritable();
  const [picsFile, metaFile, plantsFile, speciesFile, annotationsFile, analysesFile, relFile] =
    await Promise.all([
      loadJson<PicsFile>("pics.json"),
      loadJson<MetadataFile>("pic-metadata.json"),
      loadJson<{ plants?: OrganismRecord[] }>("plants.json"),
      loadJson<{ species?: Record<string, Species> }>("species.json"),
      loadJson<AnnotationsFile>("annotations.json"),
      loadJson<AnalysesFile>("ai_analysis.json"),
      loadJson<RelationshipsFile>("relationships.json"),
    ]);

  const pics = picsFile.pics ?? [];
  const doomed = pics.filter((p) => p.shortCode === shortCode);

  // Journal entries and their pic metadata.
  await driveSaveJson("pics.json", { pics: pics.filter((p) => p.shortCode !== shortCode) });
  const doomedIds = new Set(doomed.map((p) => p.id));
  await driveSaveJson("pic-metadata.json", {
    picMetadata: (metaFile.picMetadata ?? []).filter((m) => !doomedIds.has(m.id)),
  });

  // Plant record, and the species entry when nothing else references it.
  const plants = plantsFile.plants ?? [];
  const plant = plants.find((p) => p.shortCode === shortCode);
  const remainingPlants = plants.filter((p) => p.shortCode !== shortCode);
  if (remainingPlants.length !== plants.length) {
    await driveSaveJson("plants.json", { plants: remainingPlants });
  }
  if (plant?.fullName) {
    const slug = slugifyName(plant.fullName);
    const stillUsed = remainingPlants.some((p) => p.fullName && slugifyName(p.fullName) === slug);
    const species = speciesFile.species ?? {};
    if (!stillUsed && species[slug]) {
      delete species[slug];
      await driveSaveJson("species.json", { species });
    }
  }

  // Annotations, AI analyses, and relationship edges keyed to this organism.
  const annotations = annotationsFile.annotations ?? [];
  const remainingAnnotations = annotations.filter((a) => a.shortCode !== shortCode);
  if (remainingAnnotations.length !== annotations.length) {
    await driveSaveJson("annotations.json", { annotations: remainingAnnotations });
  }
  const analyses = analysesFile.analyses ?? [];
  const remainingAnalyses = analyses.filter((a) => a.shortCode !== shortCode);
  if (remainingAnalyses.length !== analyses.length) {
    await driveSaveJson("ai_analysis.json", { analyses: remainingAnalyses });
  }
  const rels = relFile.relationships ?? [];
  const remainingRels = rels.filter((r) => r.from !== shortCode && r.to !== shortCode);
  if (remainingRels.length !== rels.length) {
    await driveSaveJson("relationships.json", {
      types: relFile.types ?? [],
      relationships: remainingRels,
    });
  }

  // Remove uploaded images last; the records that pointed at them are gone, so a
  // failed delete only leaves a harmless orphan file.
  for (const pic of doomed) {
    if (pic.image.startsWith(DRIVE_IMAGE_PREFIX)) {
      await driveDeleteImage(pic.image.slice(DRIVE_IMAGE_PREFIX.length)).catch(() => {});
    }
  }

  notifyDataChanged();
}

/**
 * Delete a zone: its `zones.json` record, every zone photo (and their uploaded
 * images), and any zone-scoped annotations / AI analyses. Refuses when journal
 * entries still live in the zone — reassign or delete those first so no entry is
 * left pointing at a zone that no longer exists.
 */
export async function deleteZone(code: string): Promise<void> {
  assertWritable();
  const [picsFile, zonesFile, zonePicsFile, annotationsFile, analysesFile] = await Promise.all([
    loadJson<PicsFile>("pics.json"),
    loadJson<{ zones?: Zone[] }>("zones.json"),
    loadJson<ZonePicsFile>("zone_pics.json"),
    loadJson<AnnotationsFile>("annotations.json"),
    loadJson<AnalysesFile>("ai_analysis.json"),
  ]);

  const inZone = (picsFile.pics ?? []).filter((p) => p.zoneCode === code);
  if (inZone.length > 0) {
    throw new Error(
      `${inZone.length} entr${inZone.length === 1 ? "y is" : "ies are"} still in this zone. Move or delete them first.`,
    );
  }

  const zones = zonesFile.zones ?? [];
  const remainingZones = zones.filter((z) => z.code !== code);
  if (remainingZones.length !== zones.length) {
    await driveSaveJson("zones.json", { zones: remainingZones });
  }

  const zonePics = zonePicsFile.zonePics ?? [];
  const doomedPics = zonePics.filter((z) => z.zoneCode === code);
  if (doomedPics.length > 0) {
    await driveSaveJson("zone_pics.json", { zonePics: zonePics.filter((z) => z.zoneCode !== code) });
  }

  const annotations = annotationsFile.annotations ?? [];
  const remainingAnnotations = annotations.filter((a) => a.zoneCode !== code);
  if (remainingAnnotations.length !== annotations.length) {
    await driveSaveJson("annotations.json", { annotations: remainingAnnotations });
  }
  const analyses = analysesFile.analyses ?? [];
  const remainingAnalyses = analyses.filter((a) => a.zoneCode !== code);
  if (remainingAnalyses.length !== analyses.length) {
    await driveSaveJson("ai_analysis.json", { analyses: remainingAnalyses });
  }

  for (const pic of doomedPics) {
    if (pic.image.startsWith(DRIVE_IMAGE_PREFIX)) {
      await driveDeleteImage(pic.image.slice(DRIVE_IMAGE_PREFIX.length)).catch(() => {});
    }
  }

  notifyDataChanged();
}

/**
 * Edit a clade's Wikipedia-sourced info in `taxa.json` (the description and
 * source URL shown on internal Tree View nodes). Keyed by the taxon name, which
 * is the same key the enrichment pipeline writes; a manual edit here sits
 * alongside enriched entries and is preserved on re-runs. Creates the entry if
 * the clade hasn't been enriched yet.
 */
export async function updateTaxon(
  name: string,
  fields: { description?: string; url?: string },
): Promise<void> {
  assertWritable();
  const taxa = await loadJson<Record<string, TaxaInfo>>("taxa.json");
  const entry = taxa[name] ?? { description: "", url: "" };
  if (fields.description !== undefined) entry.description = fields.description;
  if (fields.url !== undefined) entry.url = fields.url;
  taxa[name] = entry;
  await driveSaveJson("taxa.json", taxa);
  notifyDataChanged();
}

interface ZonePicsFile {
  zonePics?: ZonePic[];
}

/**
 * Upload a new photo for a zone. It becomes the zone's displayed image (zone
 * cards and the drawer's zone panel show the most recent pic). Creates the zone
 * in zones.json if it doesn't exist yet, mirroring `addEntries`.
 */
export async function addZonePic(
  zoneCode: string,
  file: File,
  description: string | null = null,
): Promise<void> {
  assertWritable();
  assertValidCode("zone code", zoneCode);
  const { blob } = await resizeImage(file);
  const ts = Math.floor(Date.now() / 1000);
  const fileId = await driveUploadImage(`zone-${zoneCode}-${ts}.jpg`, blob);
  const id = `${zoneCode}-${ts}`;

  const [zonePicsFile, zonesFile] = await Promise.all([
    loadJson<ZonePicsFile>("zone_pics.json"),
    loadJson<{ zones?: Zone[] }>("zones.json"),
  ]);
  const zonePics = zonePicsFile.zonePics ?? [];
  const zones = zonesFile.zones ?? [];

  if (!zones.some((z) => z.code === zoneCode)) {
    zones.push({ code: zoneCode, name: zoneCode });
    await driveSaveJson("zones.json", { zones });
  }

  // Newest first: consumers pick the leading pic per zone as the display image.
  zonePics.unshift({
    id,
    zoneCode,
    image: `${DRIVE_IMAGE_PREFIX}${fileId}`,
    addedAt: new Date().toISOString(),
    postedBy: await authorName(),
    description,
  });
  await driveSaveJson("zone_pics.json", { zonePics });
  notifyDataChanged();
}

/** Remove a zone photo and its uploaded image file. */
export async function deleteZonePic(id: string): Promise<void> {
  assertWritable();
  const zonePicsFile = await loadJson<ZonePicsFile>("zone_pics.json");
  const zonePics = zonePicsFile.zonePics ?? [];
  const pic = zonePics.find((z) => z.id === id);
  if (!pic) return;

  await driveSaveJson("zone_pics.json", { zonePics: zonePics.filter((z) => z.id !== id) });
  if (pic.image.startsWith(DRIVE_IMAGE_PREFIX)) {
    await driveDeleteImage(pic.image.slice(DRIVE_IMAGE_PREFIX.length)).catch(() => {
      // The zone pic record is gone; a stray image file is harmless.
    });
  }
  notifyDataChanged();
}

/**
 * Edit a species' description in `species.json` (the "about this species" text
 * shown in the detail views). Keyed by the species id/slug. Enrichment won't
 * clobber a manual edit: `runWikipedia` skips any entry that already has a
 * description and whose `wikipedia` source is marked.
 */
export async function updateSpecies(
  id: string,
  fields: { description?: string | null },
): Promise<void> {
  assertWritable();
  const file = await loadJson<{ species?: Record<string, Species> }>("species.json");
  const species = file.species ?? {};
  const entry = species[id];
  if (!entry) throw new Error(`Species not found: ${id}`);
  if (fields.description !== undefined) entry.description = fields.description;
  await driveSaveJson("species.json", { species });
  notifyDataChanged();
}

/**
 * Change the species (scientific name) and/or common name for a set of plants —
 * all the shortCodes under one Tree View species node. Both are plant-level
 * fields in `plants.json`, and the scientific name is the key that links a plant
 * to its `species.json` entry (via `slugifyName`).
 *
 * The identity is mirrored onto the species entry so the detail view has a
 * matching record immediately and a hand-written description survives the
 * enrichment pass (`runWikipedia` only fills a blank description). A changed
 * scientific name re-links the plants to a (possibly brand-new) species entry,
 * so enrichment is kicked off to populate its taxonomy / description / native
 * range — the "necessary integration execution".
 */
export async function updatePlantNames(
  shortCodes: string[],
  fields: { fullName?: string | null; commonName?: string | null; description?: string | null },
): Promise<void> {
  assertWritable();
  const codes = new Set(shortCodes);
  const [plantsFile, speciesFile] = await Promise.all([
    loadJson<{ plants?: OrganismRecord[] }>("plants.json"),
    loadJson<{ species?: Record<string, Species> }>("species.json"),
  ]);
  const plants = plantsFile.plants ?? [];
  const speciesBundle = speciesFile.species ?? {};

  let fullNameChanged = false;
  let plantsChanged = false;
  for (const p of plants) {
    if (!codes.has(p.shortCode)) continue;
    if (fields.fullName !== undefined && fields.fullName !== p.fullName) {
      p.fullName = fields.fullName;
      fullNameChanged = true;
      plantsChanged = true;
    }
    if (fields.commonName !== undefined && fields.commonName !== p.commonName) {
      p.commonName = fields.commonName;
      plantsChanged = true;
    }
  }
  if (plantsChanged) await driveSaveJson("plants.json", { plants });

  // Keep species.json in step with the new identity (keyed by the slug the
  // loader derives from fullName). Clearing the scientific name un-identifies
  // the plant, so there's no species entry to mirror onto.
  let speciesChanged = false;
  if (fields.fullName) {
    const slug = slugifyName(fields.fullName);
    const existing = speciesBundle[slug];
    const entry: Species = existing ?? {
      id: slug,
      fullName: fields.fullName,
      commonName: null,
      description: null,
      vernacularNames: [],
      taxonomy: null,
      nativeRange: null,
      references: [],
      sources: [],
    };
    if (!existing) speciesChanged = true;
    if (entry.fullName !== fields.fullName) {
      entry.fullName = fields.fullName;
      speciesChanged = true;
    }
    if (fields.commonName !== undefined && entry.commonName !== fields.commonName) {
      entry.commonName = fields.commonName;
      speciesChanged = true;
    }
    if (fields.description !== undefined && entry.description !== fields.description) {
      entry.description = fields.description;
      speciesChanged = true;
    }
    if (speciesChanged) {
      speciesBundle[slug] = entry;
      await driveSaveJson("species.json", { species: speciesBundle });
    }
  }

  if (plantsChanged || speciesChanged) notifyDataChanged();
  if (fullNameChanged) enrichGardenInBackground();
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
