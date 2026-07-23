import type { KVNamespace } from "./types";
import { claimUsername, isValidUsername, lookupUsername, normalizeUsername } from "./usernames";

/**
 * Minimal env for the public proxy: the Drive API key, plus the KV namespace
 * backing custom share-link usernames. Deliberately not the bot's `Env` — this
 * worker is deployed separately (see wrangler.public.toml) and carries none of
 * the Telegram bot's bindings or secrets.
 */
export interface PublicEnv {
  GOOGLE_API_KEY?: string;
  // Username -> manifestId index for `?u=<name>` share links. Optional: when
  // unbound, custom links are simply unavailable and the routes 501.
  USERNAMES?: KVNamespace;
}

/**
 * Public-garden read proxy. Anonymous visitors can't fetch a published garden's
 * files straight from Drive: `files.get?alt=media` redirects file downloads to a
 * host with no CORS headers, and the shared anonymous Drive quota trips under any
 * real load (surfacing as opaque CORS failures). This worker fetches the files
 * server-side — where neither problem exists — edge-caches them, and re-serves
 * with permissive CORS. Drive is then hit roughly once per file globally.
 *
 * Routes:
 *   GET /public/manifest/{manifestId}      -> the manifest JSON (short TTL)
 *   GET /public/file/{fileId}?m={manifest} -> a bundle or image referenced by it
 *
 * Abuse guard: /public/file only serves fileIds actually listed in the named
 * manifest (or the manifest itself), so it can't be used as an open Drive CDN.
 */

const DRIVE = "https://www.googleapis.com/drive/v3/files";

// Drive fileIds are URL-safe base64-ish; reject anything else before it reaches
// a subrequest URL.
const ID_RE = /^[A-Za-z0-9_-]{10,255}$/;

const MANIFEST_TTL = 60; // seconds — bundles change when the owner edits
const IMMUTABLE_TTL = 31536000; // image bytes for a fileId never change
// A username->manifestId mapping is stable (a garden's manifest fileId is reused
// across re-publishes), so resolves can be edge-cached for a few minutes. This is
// what keeps KV reads far under the free-tier daily cap under real traffic.
const USERNAME_TTL = 300;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

interface Manifest {
  data?: Record<string, string>;
  images?: Record<string, { thumb: string | null }>;
}

/** Every fileId a manifest legitimately references (bundles, full images, thumbs). */
export function allowedIds(m: Manifest): Set<string> {
  const s = new Set<string>();
  for (const id of Object.values(m.data ?? {})) s.add(id);
  for (const [full, info] of Object.entries(m.images ?? {})) {
    s.add(full);
    if (info?.thumb) s.add(info.thumb);
  }
  return s;
}

export function isDriveId(id: string | undefined | null): id is string {
  return !!id && ID_RE.test(id);
}

function driveMediaUrl(fileId: string, env: PublicEnv): string {
  return `${DRIVE}/${encodeURIComponent(fileId)}?alt=media&key=${env.GOOGLE_API_KEY}`;
}

/** Fetch + parse a manifest, letting Cloudflare cache the Drive subrequest. */
async function loadManifest(manifestId: string, env: PublicEnv): Promise<Manifest | null> {
  const res = await fetch(driveMediaUrl(manifestId, env), {
    cf: { cacheEverything: true, cacheTtl: MANIFEST_TTL },
  });
  if (!res.ok) return null;
  return (await res.json()) as Manifest;
}

/**
 * Serve a Drive file's bytes, edge-caching the worker response so repeat
 * requests skip both Drive and re-processing.
 */
async function serveFile(
  request: Request,
  env: PublicEnv,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
  fileId: string,
  ttl: number,
): Promise<Response> {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const upstream = await fetch(driveMediaUrl(fileId, env));
  if (!upstream.ok) {
    // 404s (unpublished / deleted) pass through; everything else is a gateway
    // error. Never cached.
    return new Response(`upstream ${upstream.status}`, {
      status: upstream.status === 404 ? 404 : 502,
      headers: CORS,
    });
  }

  const headers = new Headers(CORS);
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("cache-control", `public, max-age=${ttl}${ttl >= IMMUTABLE_TTL ? ", immutable" : ""}`);
  const resp = new Response(upstream.body, { status: 200, headers });
  ctx.waitUntil(cache.put(request, resp.clone()));
  return resp;
}

function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", ...(extra ?? {}) },
  });
}

/**
 * The Google account `sub` behind an access token, or null if the token is
 * missing/expired/invalid. Validated by calling Google's userinfo endpoint
 * server-side — no JWT crypto needed, and it proves the token is live, not just
 * well-formed. This is the only gate on claiming a username.
 */
async function verifyGoogleSub(token: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { sub?: string };
    return u.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * `/public/user/{username}` — resolve (GET, public) or claim (POST, authed).
 *
 * GET returns `{ manifestId }` for a claimed name, edge-cached so a burst of
 * visitors to the same `?u=` link costs one KV read, not one per visitor.
 * POST verifies the caller's Google token and writes the mapping, refusing a
 * name another account already holds.
 */
async function handleUsername(
  request: Request,
  env: PublicEnv,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
  rawName: string,
): Promise<Response> {
  if (!env.USERNAMES) return json({ error: "Custom links are not configured" }, 501);
  const username = normalizeUsername(rawName);
  if (!isValidUsername(username)) return json({ error: "Invalid username" }, 400);

  if (request.method === "GET") {
    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;
    const record = await lookupUsername(env.USERNAMES, username);
    // Absent names aren't cached, so a name claimed moments later resolves at
    // once. A *re-pointed* name can serve its old target for up to USERNAME_TTL.
    if (!record) return json({ error: "Not found" }, 404);
    const resp = json({ manifestId: record.manifestId }, 200, {
      "cache-control": `public, max-age=${USERNAME_TTL}`,
    });
    ctx.waitUntil(cache.put(request, resp.clone()));
    return resp;
  }

  if (request.method === "POST") {
    const auth = request.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const sub = token ? await verifyGoogleSub(token) : null;
    if (!sub) return json({ error: "Sign in to claim a custom link" }, 401);

    let body: { manifestId?: unknown };
    try {
      body = (await request.json()) as { manifestId?: unknown };
    } catch {
      return json({ error: "Bad request body" }, 400);
    }
    const manifestId = typeof body.manifestId === "string" ? body.manifestId : "";
    const result = await claimUsername(env.USERNAMES, username, manifestId, sub);
    if (!result.ok) return json({ error: result.message }, result.status);
    return json({ username, manifestId });
  }

  return json({ error: "Method not allowed" }, 405);
}

/** Route a `/public/*` request. Returns null if the path isn't ours. */
export async function handlePublicProxy(
  request: Request,
  env: PublicEnv,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/public/")) return null;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // Custom share-link usernames (?u=<name>): resolve is a public GET, claim is an
  // authenticated POST. Handled before the API-key guard since resolve needs no
  // Drive key — only the KV binding.
  const userMatch = url.pathname.match(/^\/public\/user\/([^/]+)$/);
  if (userMatch) return handleUsername(request, env, ctx, decodeURIComponent(userMatch[1]));

  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: CORS });
  if (!env.GOOGLE_API_KEY) return new Response("Proxy not configured", { status: 500, headers: CORS });

  const manifestMatch = url.pathname.match(/^\/public\/manifest\/([^/]+)$/);
  if (manifestMatch) {
    const id = decodeURIComponent(manifestMatch[1]);
    if (!isDriveId(id)) return new Response("Bad id", { status: 400, headers: CORS });
    return serveFile(request, env, ctx, id, MANIFEST_TTL);
  }

  const fileMatch = url.pathname.match(/^\/public\/file\/([^/]+)$/);
  if (fileMatch) {
    const fileId = decodeURIComponent(fileMatch[1]);
    const manifestId = url.searchParams.get("m") ?? "";
    if (!isDriveId(fileId) || !isDriveId(manifestId)) {
      return new Response("Bad id", { status: 400, headers: CORS });
    }
    const manifest = await loadManifest(manifestId, env);
    if (!manifest) return new Response("Unknown manifest", { status: 404, headers: CORS });

    const allowed = allowedIds(manifest);
    if (fileId !== manifestId && !allowed.has(fileId)) {
      // Not referenced by this manifest — refuse, so we're not an open proxy.
      return new Response("Forbidden", { status: 403, headers: CORS });
    }
    // Data bundles get the short TTL (they change on edit); images are immutable.
    const isBundle = Object.values(manifest.data ?? {}).includes(fileId) || fileId === manifestId;
    return serveFile(request, env, ctx, fileId, isBundle ? MANIFEST_TTL : IMMUTABLE_TTL);
  }

  return new Response("Not found", { status: 404, headers: CORS });
}
