import { PUBLIC_PROXY_URL } from "./config";

/**
 * Custom share-link usernames. A garden owner can claim a short name so their
 * garden opens at `plantyj.com/?u=<name>` instead of the long
 * `?public=<manifestFileId>` link. The name is stored server-side in the public
 * proxy worker's KV (see worker/src/usernames.ts); this module is the browser
 * client for resolving and claiming one.
 *
 * When PUBLIC_PROXY_URL is unset (local dev without the worker) custom links are
 * unavailable — resolve returns null and claim throws — and the app falls back
 * to plain `?public=` links.
 */

// 2–30 chars, lowercase alphanumeric and hyphens, no leading/trailing hyphen.
// Must stay in sync with USERNAME_RE in worker/src/usernames.ts.
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/;

// Mirror of the worker's reserved list; a name here is rejected client-side too
// so the UI can explain it before a round trip. The worker enforces it anyway.
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

/** Whether custom links are available in this deployment (worker configured). */
export function customLinksAvailable(): boolean {
  return !!PUBLIC_PROXY_URL;
}

/**
 * Resolve a claimed username to its garden's manifest fileId, or null if the
 * name is unclaimed / malformed / the worker is unavailable. Edge-cached by the
 * worker, so repeat loads of the same `?u=` link don't each hit KV.
 */
export async function resolveUsername(username: string): Promise<string | null> {
  const name = normalizeUsername(username);
  if (!PUBLIC_PROXY_URL || !isValidUsername(name)) return null;
  try {
    const res = await fetch(`${PUBLIC_PROXY_URL}/public/user/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { manifestId?: string };
    return body.manifestId ?? null;
  } catch {
    return null;
  }
}

export class UsernameTakenError extends Error {
  constructor() {
    super("That name is already taken.");
    this.name = "UsernameTakenError";
  }
}

/**
 * Claim (or re-point) `username` for the given manifest, authenticated with the
 * caller's Google access token. Throws UsernameTakenError when the name belongs
 * to another account, or a generic Error on any other failure.
 */
export async function claimUsername(
  username: string,
  manifestId: string,
  token: string,
): Promise<void> {
  const name = normalizeUsername(username);
  if (!PUBLIC_PROXY_URL) throw new Error("Custom links aren't available in this deployment.");
  if (!isValidUsername(name)) {
    throw new Error("Use 2–30 letters, numbers, or hyphens (no leading/trailing hyphen).");
  }
  const res = await fetch(`${PUBLIC_PROXY_URL}/public/user/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ manifestId }),
  });
  if (res.status === 409) throw new UsernameTakenError();
  if (!res.ok) throw new Error(`Couldn't save that link (${res.status}).`);
}

/** The pretty share URL for a claimed username. */
export function usernameShareUrl(username: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?u=${normalizeUsername(username)}`;
}
