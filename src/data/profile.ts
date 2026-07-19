import { driveLoadJson, driveSaveJson } from "./driveSource";
import { resizeImage } from "../utils/resizeImage";

/**
 * A cloud user's editable account identity — a display name and avatar they
 * choose for their garden, overriding the Google profile. Like everything
 * else it lives in their own Drive (`data/profile.json`); the picture is a
 * small resized data URL kept inline so it renders without a second fetch and
 * survives Drive's short-lived thumbnail links.
 */

/**
 * How far a cloud user has gotten through the guided tour. Stage 1 (the
 * getting-started prompt) runs against an empty garden; stage 2 (the feature
 * tour) can only run once they have plants, since every anchor it points at is
 * gated behind having data. Stored rather than derived so a user who skips is
 * never asked twice.
 */
export const TOUR_NONE = 0;
export const TOUR_STARTED = 1; // stage 1 seen
export const TOUR_DONE = 2; // stage 2 seen — nothing left to show

export interface GardenProfile {
  name: string | null;
  picture: string | null; // data URL, or null to fall back to the Google avatar
  hideAI: boolean; // opt out of every model-assisted feature in the UI
  tourStage: number; // TOUR_NONE | TOUR_STARTED | TOUR_DONE
}

const PROFILE_FILE = "profile.json";

// The profile lives in Drive, so it isn't readable until a fetch resolves. The
// AI opt-out has to be known at first paint (otherwise the features a user
// asked to hide flash in and out), so it's mirrored to localStorage and read
// synchronously from there while the real profile loads. The tour stage rides
// along for the same reason: without it a returning user gets the tour again
// in the window before Drive answers.
const HIDE_AI_KEY = "plantyj:hide-ai";
const TOUR_STAGE_KEY = "plantyj:tour-stage";

function readHideAIMirror(): boolean {
  try {
    return localStorage.getItem(HIDE_AI_KEY) === "1";
  } catch {
    return false;
  }
}

function readTourStageMirror(): number {
  try {
    const raw = Number(localStorage.getItem(TOUR_STAGE_KEY));
    return Number.isFinite(raw) ? raw : TOUR_NONE;
  } catch {
    return TOUR_NONE;
  }
}

function writeMirrors(profile: GardenProfile): void {
  try {
    localStorage.setItem(HIDE_AI_KEY, profile.hideAI ? "1" : "0");
    localStorage.setItem(TOUR_STAGE_KEY, String(profile.tourStage));
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

/**
 * The user's tour progress. Safe to call during render, same as above.
 */
export function getTourStage(): number {
  return cache ? cache.tourStage : readTourStageMirror();
}

/**
 * Record tour progress. Writes the mirror immediately so the tour can't
 * re-trigger while the Drive save is in flight, and never moves the stage
 * backwards (a stale stage-1 completion must not undo a finished tour).
 */
export async function advanceTourStage(stage: number): Promise<void> {
  const current = await loadProfile().catch(getCachedProfile);
  const base = current ?? { name: null, picture: null, hideAI: false, tourStage: TOUR_NONE };
  if (base.tourStage >= stage) return;
  await saveProfile({ ...base, tourStage: stage });
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
      cache = {
        name: p.name ?? null,
        picture: p.picture ?? null,
        hideAI: p.hideAI ?? false,
        // An account created before the tour existed has no stage recorded.
        // Treating that as TOUR_NONE would tour an established garden, so
        // absent-but-non-empty is resolved by the caller, not here.
        tourStage: p.tourStage ?? TOUR_NONE,
      };
      writeMirrors(cache);
      window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
      return cache;
    })
    .catch((err) => {
      loadPromise = null;
      throw err;
    });
  return loadPromise;
}

/**
 * Persist a new name/avatar to Drive and update the cache.
 *
 * `tourStage` is optional because most callers (the account editor, the AI
 * toggle) rebuild the profile field-by-field and have no reason to know about
 * it; omitting it carries the stored stage forward rather than resetting it.
 */
export async function saveProfile(
  update: Omit<GardenProfile, "tourStage"> & { tourStage?: number },
): Promise<GardenProfile> {
  const next: GardenProfile = {
    name: update.name?.trim() || null,
    picture: update.picture || null,
    hideAI: update.hideAI,
    tourStage: update.tourStage ?? cache?.tourStage ?? TOUR_NONE,
  };
  await driveSaveJson(PROFILE_FILE, next);
  cache = next;
  writeMirrors(next);
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
  return next;
}

/** Clear the cache on sign-out / account switch / deletion. */
export function resetProfile(): void {
  cache = null;
  loadPromise = null;
  // The mirrors describe the account that just went away, not the next one.
  writeMirrors({ name: null, picture: null, hideAI: false, tourStage: TOUR_NONE });
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
