"use strict";

/* PWAオフラインキャッシュ用Service Worker。CDNのURLはCLAUDE.mdの方針通りバージョン固定のため、
   イミュータブルとみなしキャッシュ対象に含める。 */

const CACHE_VERSION = "v2";
const CACHE_NAME = `asset-sim-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "https://cdn.tailwindcss.com",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(new Request(url, { mode: "no-cors" })).catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
