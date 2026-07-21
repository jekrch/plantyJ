/**
 * Shape of `public.json` — the manifest an owner writes when publishing a
 * garden and an anonymous visitor bootstraps from. It exists because a plain
 * API key (no signed-in user) cannot `files.list`, so file IDs can't be
 * discovered by listing the folder; the manifest hands them over directly.
 *
 * The share URL carries this file's own Drive ID: `?public=<manifestFileId>`.
 */
export interface PublicManifest {
  version: number;
  publishedAt: string;
  /** Data bundle name (e.g. "pics.json") -> Drive fileId. */
  data: Record<string, string>;
  /** Full-image Drive fileId -> its pre-generated thumbnail's fileId (or null). */
  images: Record<string, { thumb: string | null }>;
}

export const MANIFEST_FILE = "public.json";
export const MANIFEST_VERSION = 1;

/** Data files that are app-internal plumbing, never requested via loadJson. */
export const INTERNAL_DATA_FILES = new Set([MANIFEST_FILE, "thumbnails.json"]);

/**
 * Snapshot the garden's current file IDs into a manifest. Pure — the caller
 * supplies the live maps — so it's exercised directly in tests. Two invariants
 * it enforces: app-internal bundles (`public.json`, `thumbnails.json`) never
 * appear under `data`, and thumbnail files never appear as their own `images`
 * key (they'd otherwise be served as full images no record points at).
 */
export function buildManifest(input: {
  dataFiles: Map<string, string>;
  imageIds: Iterable<string>;
  thumbs: Map<string, string>;
  publishedAt?: string;
}): PublicManifest {
  const data: Record<string, string> = {};
  for (const [name, id] of input.dataFiles) {
    if (!INTERNAL_DATA_FILES.has(name)) data[name] = id;
  }
  const thumbIds = new Set(input.thumbs.values());
  const images: Record<string, { thumb: string | null }> = {};
  for (const id of input.imageIds) {
    if (thumbIds.has(id)) continue; // a thumbnail file, not a referenced image
    images[id] = { thumb: input.thumbs.get(id) ?? null };
  }
  return {
    version: MANIFEST_VERSION,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    data,
    images,
  };
}
