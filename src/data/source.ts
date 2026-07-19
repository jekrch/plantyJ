import { driveImageUrl, driveLoadJson } from "./driveSource";

/**
 * Data-source switch: the founder's garden served statically with the site, or the
 * signed-in user's own garden in their Google Drive. The active mode is
 * persisted in localStorage and applied at page load; switching reloads the
 * app so every consumer starts from a clean slate.
 */

export type SourceMode = "static" | "drive";

const MODE_KEY = "plantyj:source";

export function getSourceMode(): SourceMode {
  try {
    return localStorage.getItem(MODE_KEY) === "drive" ? "drive" : "static";
  } catch {
    return "static";
  }
}

export function isDriveMode(): boolean {
  return getSourceMode() === "drive";
}

/** Whether the active source supports uploads/edits (Drive mode only). */
export function isWritable(): boolean {
  return isDriveMode();
}

export function setSourceMode(mode: SourceMode): void {
  if (mode === getSourceMode()) return;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    return;
  }
  window.location.reload();
}

/** Load a data bundle (e.g. "pics.json") from the active source. */
export async function loadJson<T>(name: string): Promise<T> {
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
    return driveImageUrl(image.slice(DRIVE_IMAGE_PREFIX.length), size);
  }
  if (/^https?:\/\//.test(image)) return image;
  return `${import.meta.env.BASE_URL}${image}`;
}

/** Fired after any successful mutation; data hooks refetch on it. */
export const DATA_CHANGED_EVENT = "plantyj:data-changed";

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}
