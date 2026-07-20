import {
  createFile,
  deleteFile,
  downloadBlob,
  downloadJson,
  ensureFolder,
  listFiles,
  quote,
  updateFileContent,
} from "./driveClient";

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
  dataId: string;
  imagesId: string;
  dataFiles: Map<string, string>; // file name -> fileId
  images: Map<string, ImageUrls>; // fileId -> render URLs
}

let state: DriveState | null = null;
let initPromise: Promise<void> | null = null;

export function resetDrive(): void {
  state = null;
  initPromise = null;
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
    state = {
      dataId,
      imagesId,
      dataFiles: new Map(dataList.map((f) => [f.name, f.id])),
      images: new Map(imageList.map((f) => [f.id, { thumb: f.thumbnailLink ?? null, local: null }])),
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

export function driveSaveJson(name: string, obj: unknown): Promise<void> {
  return enqueue(async () => {
    await initDrive();
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const existing = state!.dataFiles.get(name);
    if (existing) {
      await updateFileContent(existing, blob);
    } else {
      const f = await createFile(name, state!.dataId, blob, "id,name");
      state!.dataFiles.set(name, f.id);
    }
  });
}

/** Upload an image blob to `PlantyJ/images/`; returns the Drive fileId. */
export function driveUploadImage(name: string, blob: Blob): Promise<string> {
  return enqueue(async () => {
    await initDrive();
    const f = await createFile(name, state!.imagesId, blob);
    state!.images.set(f.id, {
      thumb: f.thumbnailLink ?? null,
      local: URL.createObjectURL(blob),
    });
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
