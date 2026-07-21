/**
 * Minimal env for the public proxy: just the Drive API key. Deliberately not the
 * bot's `Env` — this worker is deployed separately (see wrangler.public.toml) and
 * carries none of the Telegram bot's bindings or secrets.
 */
export interface PublicEnv {
  GOOGLE_API_KEY?: string;
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

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

/** Route a `/public/*` GET. Returns null if the path isn't ours. */
export async function handlePublicProxy(
  request: Request,
  env: PublicEnv,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/public/")) return null;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
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
