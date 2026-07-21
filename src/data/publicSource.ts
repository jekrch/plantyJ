import { GOOGLE_API_KEY } from "./config";
import type { PublicManifest } from "./publicManifest";

/**
 * Read-only view of a *published* garden, for an anonymous visitor with no
 * Google account. There is no OAuth token here — every fetch carries a public
 * API key, which only works on files that were shared `anyone: reader`.
 *
 * `files.list` needs an authenticated user, so file IDs can't be discovered by
 * listing the folder. Instead the visitor bootstraps from a single manifest
 * (`public.json`, its fileId carried in the `?public=` URL param) that hands
 * over every other file's ID. Mirrors driveSource's read surface — `loadJson`
 * and `imageUrl` — and implements none of its write surface.
 */

const MEDIA = "https://www.googleapis.com/drive/v3/files";
const PARAM = "public";

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

/** A media-endpoint URL for a public file, authorized by the API key alone. */
function mediaUrl(fileId: string): string {
  return `${MEDIA}/${encodeURIComponent(fileId)}?alt=media&key=${GOOGLE_API_KEY ?? ""}`;
}

/** Fetch and cache the manifest named by the URL param. */
export function initPublic(): Promise<void> {
  if (manifest) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!GOOGLE_API_KEY) throw new Error("Public sharing is not configured for this deployment");
    const id = getPublicManifestId();
    if (!id) throw new Error("No public garden specified");
    const res = await fetch(mediaUrl(id));
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
  const res = await fetch(mediaUrl(fileId));
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Render URL for a `drive:{fileId}` image in a published garden.
 *
 * Anonymous, keyless read straight from Drive's public image CDN — derived from
 * the fileId alone (no API key, no per-file token), and the CDN resizes on
 * demand via `=s{px}`, so it doesn't depend on the pre-generated thumbnails or
 * the manifest. NOTE: this CDN rate-limits anonymous/bursted access, so a
 * full-gallery scroll can hit 429s; it's the deliberately-chosen approach for
 * evaluating that behavior on the live domain rather than the worker proxy.
 */
export function publicImageUrl(fileId: string, size: number): string {
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=s${size}`;
}
