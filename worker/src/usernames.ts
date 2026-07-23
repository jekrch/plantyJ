/**
 * Custom share-link usernames: a short, memorable name (`?u=alice`) that resolves
 * to a garden's manifest fileId, so an owner can hand out `plantyj.com/?u=alice`
 * instead of the long `?public=<driveId>` link. Backed by a single KV namespace
 * on the public proxy worker — the only server-side state PlantyJ keeps.
 *
 * Two key shapes:
 *   name:<username>  -> {"manifestId","ownerSub"}   the public lookup + ownership
 *   owner:<sub>      -> <username>                   reverse lookup, so re-claiming
 *                                                    a new name releases the old one
 *
 * KV free-tier note: resolves are the only high-frequency op and are edge-cached
 * (see public.ts), so KV reads stay far under the daily free allowance; writes
 * happen only when an owner claims/changes a name.
 */

import type { KVNamespace } from "./types";

// 2–30 chars, lowercase alphanumeric and hyphens, no leading/trailing hyphen.
// Kept in sync with the frontend copy in src/data/username.ts.
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/;

// Names that would collide with a route, a static asset path, or just read as
// official. Anything here is refused even if otherwise well-formed.
const RESERVED = new Set([
  "public", "user", "users", "api", "admin", "root", "www", "app", "assets",
  "static", "data", "images", "img", "css", "js", "favicon", "robots",
  "sitemap", "index", "home", "about", "help", "support", "login", "logout",
  "signin", "signout", "settings", "account", "plantyj", "null", "undefined",
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(name: string): boolean {
  return USERNAME_RE.test(name) && !RESERVED.has(name);
}

// Drive fileIds are URL-safe base64-ish; mirrors public.ts's guard so a claim
// can't stash an arbitrary string as a "manifestId".
const ID_RE = /^[A-Za-z0-9_-]{10,255}$/;

export function isManifestId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

export interface UsernameRecord {
  manifestId: string;
  ownerSub: string;
}

const nameKey = (username: string) => `name:${username}`;
const ownerKey = (sub: string) => `owner:${sub}`;

/** Read the record a username points at, or null when unclaimed. */
export async function lookupUsername(
  kv: KVNamespace,
  username: string,
): Promise<UsernameRecord | null> {
  const raw = await kv.get(nameKey(username));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UsernameRecord;
  } catch {
    return null;
  }
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; status: 400 | 409; message: string };

/**
 * Claim (or re-point) `username` for the garden identified by `manifestId`, on
 * behalf of the Google account `ownerSub`. A name already held by a *different*
 * account is refused (409). When the owner previously held another name, that
 * one is released so an account never squats two.
 *
 * Not atomic — KV has no compare-and-set — but a same-instant double claim of
 * one name is a negligible race at this scale, and the ownerSub check means the
 * worst case is a redundant last-write-wins between the same owner's tabs.
 */
export async function claimUsername(
  kv: KVNamespace,
  username: string,
  manifestId: string,
  ownerSub: string,
): Promise<ClaimResult> {
  if (!isValidUsername(username)) {
    return { ok: false, status: 400, message: "Invalid username" };
  }
  if (!isManifestId(manifestId)) {
    return { ok: false, status: 400, message: "Invalid manifest id" };
  }

  const existing = await lookupUsername(kv, username);
  if (existing && existing.ownerSub !== ownerSub) {
    return { ok: false, status: 409, message: "That name is already taken" };
  }

  const prevName = await kv.get(ownerKey(ownerSub));
  if (prevName && prevName !== username) {
    await kv.delete(nameKey(prevName));
  }

  const record: UsernameRecord = { manifestId, ownerSub };
  await kv.put(nameKey(username), JSON.stringify(record));
  await kv.put(ownerKey(ownerSub), username);
  return { ok: true };
}
