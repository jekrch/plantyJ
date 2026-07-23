import { GOOGLE_API_KEY, PUBLIC_PROXY_URL } from "./config";
import type { PublicManifest } from "./publicManifest";
import { resolveUsername } from "./username";

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
// `?public=<manifestFileId>` is the raw share link; `?u=<username>` is the
// pretty alias that resolves to a manifestFileId via the worker.
const PARAM = "public";
const USER_PARAM = "u";

// Below this requested longest-edge we serve the pre-generated ~320px thumbnail
// (the masonry grid); at/above it — lightbox and hero images — the full upload.
const THUMB_MAX_REQUEST = 800;

// Both share params are captured once at load, before the app's filter/view
// state can rewrite the URL and drop them (useFilterParams rebuilds the query
// string from scratch). Public mode must stay stable across in-app navigation
// and survive a reload, so mode detection reads these snapshots, not the live URL.
function captureParam(key: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
}

const CAPTURED_MANIFEST_ID: string | null = captureParam(PARAM);
const CAPTURED_USERNAME: string | null = CAPTURED_MANIFEST_ID ? null : captureParam(USER_PARAM);

// The manifest fileId, known synchronously for `?public=` links but only after
// an async resolve for `?u=` ones (filled in by initPublic).
let resolvedManifestId: string | null = CAPTURED_MANIFEST_ID;

/**
 * Whether this page load is a public share link at all — either form. Synchronous
 * and stable for the tab's life, so getSourceMode() can decide "public mode"
 * before a `?u=` username has finished resolving.
 */
export function isPublicLink(): boolean {
  return !!(CAPTURED_MANIFEST_ID || CAPTURED_USERNAME);
}

/**
 * The manifest fileId this share link points at, or null until a `?u=` link has
 * been resolved by initPublic. Callers that build file URLs run after initPublic
 * has awaited, so it's non-null by then.
 */
export function getPublicManifestId(): string | null {
  return resolvedManifestId;
}

/**
 * The share param to re-add when useFilterParams rebuilds the query string —
 * `u` for a pretty link, `public` for a raw one — so the link a visitor arrived
 * on is the link they can reload and copy.
 */
export function getShareParam(): { key: string; value: string } | null {
  if (CAPTURED_USERNAME) return { key: USER_PARAM, value: CAPTURED_USERNAME };
  if (CAPTURED_MANIFEST_ID) return { key: PARAM, value: CAPTURED_MANIFEST_ID };
  return null;
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
    // A `?u=` link carries a username, not a fileId — resolve it to the manifest
    // fileId first (once; the result is memoized on resolvedManifestId).
    if (!resolvedManifestId && CAPTURED_USERNAME) {
      resolvedManifestId = await resolveUsername(CAPTURED_USERNAME);
      if (!resolvedManifestId) throw new Error("That garden link doesn't exist");
    }
    const id = resolvedManifestId;
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
