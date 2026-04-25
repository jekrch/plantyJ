/**
 * Register the image-caching service worker.
 *
 * Only registers in production to avoid interfering with other
 * localhost projects during development. The SW is scoped to
 * the app's BASE_URL so it won't intercept requests outside it.
 */
export function registerSW() {
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return;

  const base = import.meta.env.BASE_URL; // e.g. "/repo-name/"

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then((reg) => {
        console.log("[SW] registered, scope:", reg.scope);
      })
      .catch((err) => {
        console.warn("[SW] registration failed:", err);
      });
  });
}