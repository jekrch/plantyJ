/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = "panel-images-v1";

/**
 * Cache-first strategy for image requests under the app's base path.
 * Since image filenames are stable (same name = same content),
 * once cached they're served locally until the cache version bumps.
 */

self.addEventListener("install", () => {
  // Activate immediately — no need to wait for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Purge old cache versions on activation.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("panel-images-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only cache-first for image requests within the app.
  if (request.destination !== "image") return;

  // Only handle same-origin requests under the app's scope.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes("/images/")) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
  );
});