const CACHE_NAME = "reef-command-v36";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=36",
  "./map-lidar-data.js?v=36",
  "./app.js?v=36",
  "./vendor/supabase.min.js?v=36",
  "./vendor/lucide.min.js?v=36",
  "./vendor/three.min.js",
  "./config.json",
  "./manifest.webmanifest",
  "./icons/reef-command.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.endsWith("/config.json")) return;
  if (requestUrl.pathname.endsWith("/config.local.json")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html")),
    );
    return;
  }

  if (["script", "style", "worker"].includes(event.request.destination)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
