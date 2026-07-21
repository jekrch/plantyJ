import {
  createFile,
  createPermission,
  deleteFile,
  deletePermission,
  downloadBlob,
  downloadJson,
  ensureFolder,
  listFiles,
  quote,
  updateFileContent,
} from "./driveClient";
import { buildManifest, MANIFEST_FILE } from "./publicManifest";
import { resizeImage } from "../utils/resizeImage";

/**
 * Drive-backed dataset: a visible `PlantyJ/` folder in the signed-in user's
 * own Drive, mirroring the static site's layout (`data/*.json` + `images/`).
 *
 * Images are referenced from pics.json as `drive:{fileId}` and rendered via
 * Drive's short-lived `thumbnailLink` CDN URLs (sized with `=sN`), so <img>
 * tags need no auth header. Freshly uploaded files fall back to a local
 * object URL until Drive has generated a thumbnail.
 */

const APP_FOLDER = "PlantyJ";

// Longest edge for the thumbnails referenced by the public manifest. Small
// enough that a few-hundred-photo garden scrolls without pulling tens of MB of
// full-size images through the API-key media endpoint.
export const THUMB_MAX_DIM = 320;
const THUMBS_FILE = "thumbnails.json";

// Mutation signal (kept as a literal to avoid a load-time import cycle with
// source.ts, which imports this module). While a garden is published, every
// mutation must refresh the manifest so newly minted file IDs aren't silently
// omitted from the public view.
const DATA_CHANGED = "plantyj:data-changed";

// Missing files mean an empty (or not-yet-enriched) garden, not an error.
const EMPTY_BUNDLES: Record<string, unknown> = {
  "pics.json": { pics: [] },
  "plants.json": { plants: [] },
  "zones.json": { zones: [] },
  "zone_pics.json": { zonePics: [] },
  "annotations.json": { annotations: [] },
  "taxa.json": {},
  "species.json": { species: {} },
  "ai_analysis.json": { analyses: [] },
  "garden_profile.json": { description: null },
  "embeddings.json": { embeddings: {} },
  "pic-metadata.json": { picMetadata: [] },
  "relationships.json": { types: [], relationships: [] },
};

interface ImageUrls {
  thumb: string | null;
  local: string | null;
}

interface DriveState {
  rootId: string;
  dataId: string;
  imagesId: string;
  dataFiles: Map<string, string>; // file name -> fileId
  images: Map<string, ImageUrls>; // fileId -> render URLs
  thumbs: Map<string, string>; // full-image fileId -> thumbnail fileId
}

let state: DriveState | null = null;
let initPromise: Promise<void> | null = null;

// Manifest fileId while this garden is published (null when not), so mutations
// know to refresh the public snapshot. Persisted authoritatively in the user's
// profile; mirrored here for the mutation hook and set on load / publish.
let publishedManifestId: string | null = null;

export function resetDrive(): void {
  state = null;
  initPromise = null;
  publishedManifestId = null;
}

/** Locate (or create) the PlantyJ folder tree and index its contents. */
export function initDrive(): Promise<void> {
  if (state) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const rootId = await ensureFolder(APP_FOLDER);
    const dataId = await ensureFolder("data", rootId);
    const imagesId = await ensureFolder("images", rootId);
    const [dataList, imageList] = await Promise.all([
      listFiles(`'${dataId}' in parents and trashed=false`, "id,name"),
      listFiles(`'${imagesId}' in parents and trashed=false`, "id,name,thumbnailLink"),
    ]);
    const dataFiles = new Map(dataList.map((f) => [f.name, f.id]));
    // Pre-generated thumbnail map (full fileId -> thumb fileId), if the garden
    // has ever been prepared for public sharing. Absent for gardens that never
    // have; backfill fills it lazily at publish time.
    const thumbsId = dataFiles.get(THUMBS_FILE);
    const thumbsData: { thumbs?: Record<string, string> } = thumbsId
      ? await downloadJson<{ thumbs?: Record<string, string> }>(thumbsId).catch(() => ({}))
      : {};
    state = {
      rootId,
      dataId,
      imagesId,
      dataFiles,
      images: new Map(imageList.map((f) => [f.id, { thumb: f.thumbnailLink ?? null, local: null }])),
      thumbs: new Map(Object.entries(thumbsData.thumbs ?? {})),
    };
  })().catch((err) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

export async function driveLoadJson<T>(name: string): Promise<T> {
  await initDrive();
  const fileId = state!.dataFiles.get(name);
  if (!fileId) return (EMPTY_BUNDLES[name] ?? {}) as T;
  return downloadJson<T>(fileId);
}

/**
 * Render URL for a Drive-hosted image. `size` maps to the thumbnail CDN's
 * `=sN` bounding-box parameter.
 */
export function driveImageUrl(fileId: string, size: number): string {
  const entry = state?.images.get(fileId);
  if (!entry) return "";
  if (entry.thumb) {
    return /=s\d+(-[a-z0-9]+)*$/.test(entry.thumb)
      ? entry.thumb.replace(/=s\d+(-[a-z0-9]+)*$/, `=s${size}`)
      : entry.thumb;
  }
  return entry.local ?? "";
}

// All writes are serialized through one chain so concurrent UI actions can't
// interleave read-modify-write cycles on the JSON bundles.
let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

// Write a JSON bundle to the data folder, creating or overwriting. Assumes the
// caller is already inside the write queue (or that ordering doesn't matter);
// `driveSaveJson` is the enqueued public entry point.
async function writeJsonFile(name: string, obj: unknown): Promise<void> {
  await initDrive();
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const existing = state!.dataFiles.get(name);
  if (existing) {
    await updateFileContent(existing, blob);
  } else {
    const f = await createFile(name, state!.dataId, blob, "id,name");
    state!.dataFiles.set(name, f.id);
  }
}

export function driveSaveJson(name: string, obj: unknown): Promise<void> {
  return enqueue(() => writeJsonFile(name, obj));
}

/** Persist the in-memory full->thumb fileId map. Call from inside the queue. */
async function persistThumbs(): Promise<void> {
  await writeJsonFile(THUMBS_FILE, { thumbs: Object.fromEntries(state!.thumbs) });
}

/**
 * Upload an image blob to `PlantyJ/images/`; returns the full image's Drive
 * fileId. When a `thumbBlob` is supplied it's uploaded alongside and recorded
 * in the thumbnail map, so a later publish can reference it without a resize
 * pass. (Callers building for the public view generate the thumb; the map is
 * also filled by `backfillThumbnails` for images uploaded before this existed.)
 */
export function driveUploadImage(name: string, blob: Blob, thumbBlob?: Blob): Promise<string> {
  return enqueue(async () => {
    await initDrive();
    const f = await createFile(name, state!.imagesId, blob);
    state!.images.set(f.id, {
      thumb: f.thumbnailLink ?? null,
      local: URL.createObjectURL(blob),
    });
    if (thumbBlob) {
      const t = await createFile(`thumb-${name}`, state!.imagesId, thumbBlob, "id,name");
      state!.thumbs.set(f.id, t.id);
      await persistThumbs();
    }
    return f.id;
  });
}

export function driveDeleteImage(fileId: string): Promise<void> {
  return enqueue(async () => {
    await initDrive();
    await deleteFile(fileId);
    const entry = state!.images.get(fileId);
    if (entry?.local) URL.revokeObjectURL(entry.local);
    state!.images.delete(fileId);
    // Drop the paired thumbnail too, so it doesn't outlive its full image.
    const thumbId = state!.thumbs.get(fileId);
    if (thumbId) {
      await deleteFile(thumbId).catch(() => {});
      state!.thumbs.delete(fileId);
      await persistThumbs();
    }
  });
}

export interface GardenSize {
  bytes: number;
  files: number;
}

/**
 * Total storage the PlantyJ garden occupies in the user's Drive: the summed
 * byte size of every data-JSON and image file. Folders report no size, so we
 * add up the leaf files. Listed fresh so it reflects the current contents.
 */
export async function getGardenSize(): Promise<GardenSize> {
  await initDrive();
  const [dataList, imageList] = await Promise.all([
    listFiles(`'${state!.dataId}' in parents and trashed=false`, "id,name,size"),
    listFiles(`'${state!.imagesId}' in parents and trashed=false`, "id,name,size"),
  ]);
  const all = [...dataList, ...imageList];
  const bytes = all.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
  return { bytes, files: all.length };
}

/**
 * Permanently delete the user's entire PlantyJ folder (data JSON + images)
 * from their Drive, then drop in-memory state. PlantyJ keeps nothing
 * server-side, so this — paired with revoking access (signOut) — fully erases
 * everything the app holds about a cloud user. Irreversible; callers should
 * confirm and offer a backup first.
 */
export async function deleteGarden(): Promise<void> {
  // Match ensureFolder's lookup: any PlantyJ folder the app created (drive.file
  // scope only ever surfaces our own files). Deleting a folder cascades to the
  // data/ and images/ subfolders and every file inside.
  const folders = await listFiles(
    `name=${quote(APP_FOLDER)} and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    "id,name",
  );
  for (const folder of folders) {
    await deleteFile(folder.id);
  }
  resetDrive();
}

export interface GardenFile {
  path: string;
  blob: Blob;
}

/**
 * Download every file in the PlantyJ folder (data JSON + images) so the whole
 * garden can be packaged for backup. Listed fresh from Drive so it captures
 * files created this session and any the user added out of band.
 */
export async function collectGardenFiles(
  onProgress?: (done: number, total: number) => void,
): Promise<GardenFile[]> {
  await initDrive();
  const [dataList, imageList] = await Promise.all([
    listFiles(`'${state!.dataId}' in parents and trashed=false`, "id,name"),
    listFiles(`'${state!.imagesId}' in parents and trashed=false`, "id,name"),
  ]);
  const jobs = [
    ...dataList.map((f) => ({ id: f.id, path: `PlantyJ/data/${f.name}` })),
    ...imageList.map((f) => ({ id: f.id, path: `PlantyJ/images/${f.name}` })),
  ];
  const out: GardenFile[] = [];
  let done = 0;
  for (const job of jobs) {
    out.push({ path: job.path, blob: await downloadBlob(job.id) });
    onProgress?.(++done, jobs.length);
  }
  return out;
}

// ── Public sharing ────────────────────────────────────────────────────────

/** Whether this garden is currently published (mirror of the profile flag). */
export function isPublished(): boolean {
  return publishedManifestId !== null;
}

/** The published manifest fileId, or null. */
export function publishedManifest(): string | null {
  return publishedManifestId;
}

/**
 * Sync the in-memory published flag from the loaded profile. Called when the
 * profile resolves so a garden that was published in a previous session keeps
 * refreshing its manifest on mutation.
 */
export function setPublishedManifest(manifestFileId: string | null): void {
  publishedManifestId = manifestFileId;
}

/** Build the anonymous share URL for a manifest fileId. */
export function publicShareUrl(manifestFileId: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?public=${manifestFileId}`;
}

/**
 * Generate a ~320px thumbnail for every uploaded image that doesn't have one
 * yet, uploading each and recording it in the thumbnail map. Idempotent and
 * resumable: the map is persisted after each thumbnail, so a run interrupted
 * partway resumes where it left off rather than redoing finished work.
 */
export async function backfillThumbnails(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  await initDrive();
  // Thumbnails live in the same folder, so exclude the ones we already made
  // (the values of the map) from the set that needs one.
  const thumbIds = new Set(state!.thumbs.values());
  const missing = [...state!.images.keys()].filter(
    (id) => !thumbIds.has(id) && !state!.thumbs.has(id),
  );
  let done = 0;
  onProgress?.(done, missing.length);
  for (const fullId of missing) {
    try {
      const original = await downloadBlob(fullId);
      const { blob } = await resizeImage(new File([original], "img.jpg"), THUMB_MAX_DIM);
      const t = await createFile(`thumb-${fullId}.jpg`, state!.imagesId, blob, "id,name");
      state!.thumbs.set(fullId, t.id);
      await enqueue(persistThumbs);
    } catch {
      // A single un-resizable image (corrupt, or a stray non-image) shouldn't
      // sink the whole pass; it just won't get a thumbnail in the manifest.
    }
    onProgress?.(++done, missing.length);
  }
}

/** Snapshot the current garden into a manifest. Requires initDrive to have run. */
function snapshotManifest() {
  const s = state!;
  return buildManifest({ dataFiles: s.dataFiles, imageIds: s.images.keys(), thumbs: s.thumbs });
}

/** Write (or overwrite) public.json and return its fileId. */
async function writeManifest(): Promise<string> {
  await enqueue(() => writeJsonFile(MANIFEST_FILE, snapshotManifest()));
  return state!.dataFiles.get(MANIFEST_FILE)!;
}

export interface PublishResult {
  manifestFileId: string;
  permissionId: string;
  shareUrl: string;
}

/**
 * Publish the whole garden for anonymous read: ensure every image has a
 * thumbnail, write the manifest, then grant `anyone: reader` on the PlantyJ
 * folder (Drive inherits it to every descendant). Returns the share URL and the
 * permission id needed to reverse it.
 */
export async function publishGarden(
  onProgress?: (done: number, total: number) => void,
): Promise<PublishResult> {
  await initDrive();
  await backfillThumbnails(onProgress);
  const manifestFileId = await writeManifest();
  const permissionId = await createPermission(state!.rootId, { role: "reader", type: "anyone" });
  publishedManifestId = manifestFileId;
  return { manifestFileId, permissionId, shareUrl: publicShareUrl(manifestFileId) };
}

/**
 * Revoke public access: delete the `anyone` permission on the folder. Immediate
 * and complete — every descendant loses access with it. The manifest file is
 * left in place (harmless once unreachable) and simply reused on re-publish.
 */
export async function unpublishGarden(permissionId: string): Promise<void> {
  await initDrive();
  await deletePermission(state!.rootId, permissionId).catch(() => {
    // Already gone (e.g. revoked from Drive's UI): treat as success.
  });
  publishedManifestId = null;
}

// While published, any mutation mints file IDs the snapshot doesn't yet list,
// so re-snapshot at the end of each one. Writing public.json doesn't itself
// emit this event, so there's no feedback loop. Registered once at module load.
if (typeof window !== "undefined") {
  window.addEventListener(DATA_CHANGED, () => {
    if (!publishedManifestId || !state) return;
    enqueue(() => writeJsonFile(MANIFEST_FILE, snapshotManifest())).catch(() => {});
  });
}
