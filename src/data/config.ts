// OAuth client IDs are public by design — this is not a secret. Override via
// VITE_GOOGLE_CLIENT_ID for a different deployment.
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  "996945252569-0fhinopjkdr5udal57gn000k4f44ffrv.apps.googleusercontent.com";

// Base URL of the Cloudflare worker's public read proxy (e.g.
// "https://plantyj-bot.<account>.workers.dev"). When set, published gardens are
// read through `${PUBLIC_PROXY_URL}/public/...`, which edge-caches Drive files
// and serves them with CORS — sidestepping the anonymous Drive quota and the
// CORS-less redirect that direct browser reads hit. This is the recommended
// path; the direct fallback below is only for local dev without the worker.
export const PUBLIC_PROXY_URL: string | undefined = (
  import.meta.env.VITE_PUBLIC_PROXY_URL as string | undefined
)?.replace(/\/$/, "");

// Browser API key for reading *public* Drive files directly (the no-proxy
// fallback). Only needed when PUBLIC_PROXY_URL is unset — with the proxy, the
// key lives as a worker secret instead. Public by design if used; restrict it
// by HTTP referrer in the Google Cloud console.
export const GOOGLE_API_KEY: string | undefined = import.meta.env.VITE_GOOGLE_API_KEY;
