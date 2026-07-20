import type {
  AnnotationEntry,
  Env,
  Gallery,
  PicEntry,
  PlantRecord,
  RelationshipsFile,
  Zone,
  ZonePicEntry,
} from "../types";
import { deleteFileIfExists, readJsonFile, writeJsonFile } from "./client";
import { annotationHasContent } from "./annotations";
import {
  ANNOTATIONS_PATH,
  PICS_PATH,
  PLANTS_PATH,
  RELATIONSHIPS_PATH,
  ZONE_PICS_PATH,
  ZONES_PATH,
} from "./paths";

// --- Batch helpers ---------------------------------------------------------
// loadBatchState reads gallery + annotations in a single Promise.all (5 GETs).
// Mutators in batch.ts apply changes to BatchState in memory and mark which
// JSON files got dirty. commitBatchState then writes only the dirty ones,
// turning O(N commands) GitHub round-trips into O(1) regardless of chunk size.

export type DirtyFile = "pics" | "plants" | "zones" | "zonePics" | "annotations" | "relationships";

export interface BatchState {
  gallery: Gallery;
  annotations: AnnotationEntry[];
  relationships: RelationshipsFile;
  picsSha: string | null;
  plantsSha: string | null;
  zonesSha: string | null;
  zonePicsSha: string | null;
  annotationsSha: string | null;
  relationshipsSha: string | null;
  dirty: Set<DirtyFile>;
  // Image files queued for deletion after JSON commits succeed (per /delete and
  // /deletezonepic). Each costs 2 subrequests: GET sha + DELETE.
  imagesToDelete: Array<{ path: string; message: string }>;
}

export async function loadBatchState(env: Env): Promise<BatchState> {
  const [pics, plants, zones, zonePics, ann, rels] = await Promise.all([
    readJsonFile<{ pics?: PicEntry[] }>(env, PICS_PATH, { pics: [] }),
    readJsonFile<{ plants?: PlantRecord[] }>(env, PLANTS_PATH, { plants: [] }),
    readJsonFile<{ zones?: Zone[] }>(env, ZONES_PATH, { zones: [] }),
    readJsonFile<{ zonePics?: ZonePicEntry[] }>(env, ZONE_PICS_PATH, { zonePics: [] }),
    readJsonFile<{ annotations?: AnnotationEntry[] }>(env, ANNOTATIONS_PATH, { annotations: [] }),
    readJsonFile<Partial<RelationshipsFile>>(env, RELATIONSHIPS_PATH, {
      types: [],
      relationships: [],
    }),
  ]);
  return {
    gallery: {
      pics: pics.data.pics ?? [],
      plants: plants.data.plants ?? [],
      zones: zones.data.zones ?? [],
      zonePics: zonePics.data.zonePics ?? [],
    },
    annotations: ann.data.annotations ?? [],
    relationships: {
      types: rels.data.types ?? [],
      relationships: rels.data.relationships ?? [],
    },
    picsSha: pics.sha,
    plantsSha: plants.sha,
    zonesSha: zones.sha,
    zonePicsSha: zonePics.sha,
    annotationsSha: ann.sha,
    relationshipsSha: rels.sha,
    dirty: new Set(),
    imagesToDelete: [],
  };
}

/**
 * [skip-deploy] suppresses deploy-frontend's push trigger. That's only safe
 * when something else still deploys: compute-metadata.yml watches pics /
 * plants / zones / zone_pics / annotations + images, recomputes, and chains
 * a deploy via workflow_run. relationships.json is the one manifest it
 * doesn't watch — so a relationships-only commit must deploy directly via
 * public/**, otherwise the change never reaches the site.
 */
function buildCommitMessage(state: BatchState, message: string): string {
  const willComputeMetadata =
    [...state.dirty].some((d) => d !== "relationships") || state.imagesToDelete.length > 0;
  return willComputeMetadata ? `${message} [skip-deploy]` : message;
}

export async function commitBatchState(
  env: Env,
  state: BatchState,
  message: string,
): Promise<{ jsonWrites: number; imagesDeleted: number }> {
  const commitMessage = buildCommitMessage(state, message);

  // Each PUT to the Contents API creates a commit on `main`, and GitHub updates
  // the branch ref with a compare-and-swap. Firing these in parallel
  // (Promise.all) races that CAS against itself: the first write advances HEAD,
  // and every sibling write then 409s ("is at <newHead> but expected <oldHead>")
  // even though each file's blob sha is still valid. Those 409s bubble up as a
  // job failure and the retry hits the exact same race, so the batch never
  // converges. Running the writes sequentially lets each PUT build on the HEAD
  // the previous one produced — no self-collision. The cost is a few extra
  // serialized round-trips per chunk, which stays well under the subrequest
  // budget. (Different files never collide on blob sha, so the only hazard was
  // the shared branch ref.)
  const writes: Array<() => Promise<void>> = [];
  const queue = (file: DirtyFile, path: string, body: unknown, sha: string | null) => {
    if (state.dirty.has(file)) {
      writes.push(() => writeJsonFile(env, path, body, sha, commitMessage));
    }
  };

  // Order matters: zones and plants are written before the pics that reference
  // them, so a reader never sees a pic pointing at a zone that doesn't exist.
  queue("zones", ZONES_PATH, { zones: state.gallery.zones }, state.zonesSha);
  queue("plants", PLANTS_PATH, { plants: state.gallery.plants }, state.plantsSha);
  queue("pics", PICS_PATH, { pics: state.gallery.pics }, state.picsSha);
  queue("zonePics", ZONE_PICS_PATH, { zonePics: state.gallery.zonePics }, state.zonePicsSha);
  queue(
    "annotations",
    ANNOTATIONS_PATH,
    { annotations: state.annotations.filter(annotationHasContent) },
    state.annotationsSha,
  );
  queue("relationships", RELATIONSHIPS_PATH, state.relationships, state.relationshipsSha);

  for (const write of writes) {
    await write();
  }

  let imagesDeleted = 0;
  for (const img of state.imagesToDelete) {
    try {
      if (await deleteFileIfExists(env, img.path, img.message)) imagesDeleted++;
    } catch {
      // Swallow per-image failures; the JSON manifest is the source of truth.
    }
  }
  return { jsonWrites: writes.length, imagesDeleted };
}
