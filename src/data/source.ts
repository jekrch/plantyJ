import { driveImageUrl, driveLoadJson } from "./driveSource";
import { getPublicManifestId, publicImageUrl, publicLoadJson } from "./publicSource";

/**
 * Data-source switch: the founder's garden served statically with the site, the
 * signed-in user's own garden in their Google Drive, or — for a `?public=` share
 * link — someone else's published garden, read-only over a plain API key.
 *
 * Static/Drive is persisted in localStorage and applied at page load. Public is
 * not persisted: it comes from the URL alone, so a share link works in a fresh
 * browser and never clobbers a visitor's own saved mode. Switching modes
 * reloads the app so every consumer starts from a clean slate.
 */

export type SourceMode = "static" | "drive" | "public";

const MODE_KEY = "plantyj:source";

export function getSourceMode(): SourceMode {
  // A share link wins over any stored preference: the URL is the intent.
  if (getPublicManifestId()) return "public";
  try {
    return localStorage.getItem(MODE_KEY) === "drive" ? "drive" : "static";
  } catch {
    return "static";
  }
}

export function isDriveMode(): boolean {
  return getSourceMode() === "drive";
}

/** Whether a `?public=` share link is being viewed. */
export function isPublicMode(): boolean {
  return getSourceMode() === "public";
}

/** Whether the active source supports uploads/edits (Drive mode only). */
export function isWritable(): boolean {
  return isDriveMode();
}

export function setSourceMode(mode: SourceMode): void {
  // Public mode is URL-derived, so switching away from it means dropping the
  // param (not just flipping localStorage) — otherwise the reload lands back in
  // public mode. Leaving public is always allowed even to the "same" stored mode.
  const leavingPublic = isPublicMode();
  if (mode === getSourceMode() && !leavingPublic) return;
  try {
    if (mode !== "public") localStorage.setItem(MODE_KEY, mode);
  } catch {
    if (!leavingPublic) return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("public");
  window.location.href = url.toString();
}

/** Load a data bundle (e.g. "pics.json") from the active source. */
export async function loadJson<T>(name: string): Promise<T> {
  if (isPublicMode()) return publicLoadJson<T>(name);
  if (isDriveMode()) return driveLoadJson<T>(name);
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const DRIVE_IMAGE_PREFIX = "drive:";

/**
 * Resolve a pic's `image` reference to a renderable URL. Static-site paths
 * are prefixed with the app base; `drive:{fileId}` references resolve through
 * the Drive source (`size` bounds the served image's longest edge).
 */
export function imageSrc(image: string, size = 1600): string {
  if (image.startsWith(DRIVE_IMAGE_PREFIX)) {
    const fileId = image.slice(DRIVE_IMAGE_PREFIX.length);
    return isPublicMode() ? publicImageUrl(fileId, size) : driveImageUrl(fileId, size);
  }
  if (/^https?:\/\//.test(image)) return image;
  return `${import.meta.env.BASE_URL}${image}`;
}

/** Fired after any successful mutation; data hooks refetch on it. */
export const DATA_CHANGED_EVENT = "plantyj:data-changed";

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}
