import { driveLoadJson, driveSaveJson } from "./driveSource";
import { resizeImage } from "../utils/resizeImage";

/**
 * A cloud user's editable account identity — a display name and avatar they
 * choose for their garden, overriding the Google profile. Like everything
 * else it lives in their own Drive (`data/profile.json`); the picture is a
 * small resized data URL kept inline so it renders without a second fetch and
 * survives Drive's short-lived thumbnail links.
 */

export interface GardenProfile {
  name: string | null;
  picture: string | null; // data URL, or null to fall back to the Google avatar
  hideAI: boolean; // opt out of every model-assisted feature in the UI
}

const PROFILE_FILE = "profile.json";

// The profile lives in Drive, so it isn't readable until a fetch resolves. The
// AI opt-out has to be known at first paint (otherwise the features a user
// asked to hide flash in and out), so it's mirrored to localStorage and read
// synchronously from there while the real profile loads.
const HIDE_AI_KEY = "plantyj:hide-ai";

function readHideAIMirror(): boolean {
  try {
    return localStorage.getItem(HIDE_AI_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHideAIMirror(hide: boolean): void {
  try {
    localStorage.setItem(HIDE_AI_KEY, hide ? "1" : "0");
  } catch {
    // Private-mode / storage-disabled: the profile still loads, just with a flash.
  }
}

/**
 * Whether model-assisted features should be hidden. Safe to call during
 * render: falls back to the mirrored value until the profile has loaded.
 */
export function areAIFeaturesHidden(): boolean {
  return cache ? cache.hideAI : readHideAIMirror();
}

/** Fired after the profile is saved so account UI refreshes. */
export const PROFILE_CHANGED_EVENT = "plantyj:profile-changed";

// In-memory cache so synchronous consumers (menu render, entry authorship) can
// read the profile without re-hitting Drive on every access.
let cache: GardenProfile | null = null;
let loadPromise: Promise<GardenProfile> | null = null;

/** Cached profile if already loaded this session, else null. */
export function getCachedProfile(): GardenProfile | null {
  return cache;
}

/** Load the profile from Drive (cached after first call). */
export function loadProfile(): Promise<GardenProfile> {
  if (cache) return Promise.resolve(cache);
  if (loadPromise) return loadPromise;
  loadPromise = driveLoadJson<Partial<GardenProfile>>(PROFILE_FILE)
    .then((p) => {
      cache = { name: p.name ?? null, picture: p.picture ?? null, hideAI: p.hideAI ?? false };
      writeHideAIMirror(cache.hideAI);
      window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
      return cache;
    })
    .catch((err) => {
      loadPromise = null;
      throw err;
    });
  return loadPromise;
}

/** Persist a new name/avatar to Drive and update the cache. */
export async function saveProfile(update: GardenProfile): Promise<GardenProfile> {
  const next: GardenProfile = {
    name: update.name?.trim() || null,
    picture: update.picture || null,
    hideAI: update.hideAI,
  };
  await driveSaveJson(PROFILE_FILE, next);
  cache = next;
  writeHideAIMirror(next.hideAI);
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
  return next;
}

/** Clear the cache on sign-out / account switch / deletion. */
export function resetProfile(): void {
  cache = null;
  loadPromise = null;
  // The mirror describes the account that just went away, not the next one.
  writeHideAIMirror(false);
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}

/** Resize a chosen photo to a compact square-bounded avatar data URL. */
export async function toAvatarDataUrl(file: File): Promise<string> {
  const { blob } = await resizeImage(file, 256, 0.85);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}
