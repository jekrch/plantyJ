import { driveLoadJson, driveSaveJson } from "./driveSource";

/**
 * A cloud user's reusable, free-text description of their garden's location and
 * property conditions (hardiness zone, soil, aspect, priorities, …). It stands
 * in for the property paragraph the Telegram `/analyze` worker hardcodes, so
 * the browser "draft analyses with a model" flow can ground the model in the
 * gardener's actual site. Like everything else it lives in the user's own Drive
 * (`data/garden_profile.json`).
 */

export interface GardenDescription {
  description: string | null;
}

const GARDEN_FILE = "garden_profile.json";

// In-memory cache mirroring profile.ts, so the assist modal can reopen without
// re-hitting Drive each time.
let cache: GardenDescription | null = null;
let loadPromise: Promise<GardenDescription> | null = null;

/** Load the garden description from Drive (cached after first call). */
export function loadGardenDescription(): Promise<GardenDescription> {
  if (cache) return Promise.resolve(cache);
  if (loadPromise) return loadPromise;
  loadPromise = driveLoadJson<Partial<GardenDescription>>(GARDEN_FILE)
    .then((g) => {
      cache = { description: g.description ?? null };
      return cache;
    })
    .catch((err) => {
      loadPromise = null;
      throw err;
    });
  return loadPromise;
}

/** Persist a new garden description to Drive and update the cache. */
export async function saveGardenDescription(text: string): Promise<GardenDescription> {
  const next: GardenDescription = { description: text.trim() || null };
  await driveSaveJson(GARDEN_FILE, next);
  cache = next;
  return next;
}

/** Clear the cache on sign-out / account switch / deletion. */
export function resetGardenDescription(): void {
  cache = null;
  loadPromise = null;
}
