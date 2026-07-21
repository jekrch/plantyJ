import { GOOGLE_API_KEY, PUBLIC_PROXY_URL } from "./config";
import type { PublicManifest } from "./publicManifest";

/**
 * Read-only view of a *published* garden, for an anonymous visitor with no
 * Google account and no OAuth token.
 *
 * `files.list` needs an authenticated user, so file IDs can't be discovered by
 * listing the folder. Instead the visitor bootstraps from a single manifest
 * (`public.json`, its fileId carried in the `?public=` URL param) that hands
 * over every other file's ID. Mirrors driveSource's read surface — `loadJson`
 * and `imageUrl` — and implements none of its write surface.
 *
 * Reads go through the Cloudflare worker proxy when configured (PUBLIC_PROXY_URL):
 * it fetches Drive files server-side, edge-caches them, and returns them with
 * CORS — so the anonymous Drive quota never trips and downloads don't hit the
 * CORS-less redirect a browser `fetch` can't follow. The direct fallback below
 * (API key for JSON, keyless CDN for images) is for local dev without the worker.
 */

const MEDIA = "https://www.googleapis.com/drive/v3/files";
const PARAM = "public";

// Below this requested longest-edge we serve the pre-generated ~320px thumbnail
// (the masonry grid); at/above it — lightbox and hero images — the full upload.
const THUMB_MAX_REQUEST = 800;

/** The manifest fileId from `?public=<id>`, or null when not a share link. */
export function getPublicManifestId(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(PARAM);
  } catch {
    return null;
  }
}

let manifest: PublicManifest | null = null;
let initPromise: Promise<void> | null = null;

/** URL for the manifest file itself. */
function manifestUrl(id: string): string {
  return PUBLIC_PROXY_URL
    ? `${PUBLIC_PROXY_URL}/public/manifest/${encodeURIComponent(id)}`
    : `${MEDIA}/${encodeURIComponent(id)}?alt=media&key=${GOOGLE_API_KEY ?? ""}`;
}

/** URL for any file referenced by the manifest (bundle or image). */
function fileUrl(fileId: string): string {
  if (PUBLIC_PROXY_URL) {
    const m = encodeURIComponent(getPublicManifestId() ?? "");
    return `${PUBLIC_PROXY_URL}/public/file/${encodeURIComponent(fileId)}?m=${m}`;
  }
  return `${MEDIA}/${encodeURIComponent(fileId)}?alt=media&key=${GOOGLE_API_KEY ?? ""}`;
}

/** Fetch and cache the manifest named by the URL param. */
export function initPublic(): Promise<void> {
  if (manifest) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!PUBLIC_PROXY_URL && !GOOGLE_API_KEY) {
      throw new Error("Public sharing is not configured for this deployment");
    }
    const id = getPublicManifestId();
    if (!id) throw new Error("No public garden specified");
    const res = await fetch(manifestUrl(id));
    if (!res.ok) throw new Error(`Public garden unavailable (${res.status})`);
    manifest = (await res.json()) as PublicManifest;
  })().catch((err) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

/** Load a data bundle by name from the published manifest. */
export async function publicLoadJson<T>(name: string): Promise<T> {
  await initPublic();
  const fileId = manifest!.data[name];
  // A bundle the owner never created is simply absent; consumers default it.
  if (!fileId) return {} as T;
  const res = await fetch(fileUrl(fileId));
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Render URL for a `drive:{fileId}` image in a published garden. Small requests
 * resolve to the pre-generated thumbnail when the manifest has one; full-size
 * requests (and any image without a thumbnail) resolve to the original.
 *
 * With the proxy, both go through the worker (edge-cached, CORS). Without it,
 * images fall back to Drive's keyless public CDN, which resizes via `=s{px}`
 * but rate-limits anonymous/bursted access.
 */
export function publicImageUrl(fileId: string, size: number): string {
  const thumb = size <= THUMB_MAX_REQUEST ? manifest?.images[fileId]?.thumb : null;
  const id = thumb ?? fileId;
  if (PUBLIC_PROXY_URL) return fileUrl(id);
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=s${size}`;
}
