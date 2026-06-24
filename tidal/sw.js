/* Minimal offline cache so Tidal is installable and works without a network. */
const CACHE = "tidal-v28";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./game.js",
  "./fx.js",
  "./gamecenter.js",
  "./three3d.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/three.module.js",
  "./vendor/jsm/postprocessing/EffectComposer.js",
  "./vendor/jsm/postprocessing/Pass.js",
  "./vendor/jsm/postprocessing/RenderPass.js",
  "./vendor/jsm/postprocessing/ShaderPass.js",
  "./vendor/jsm/postprocessing/MaskPass.js",
  "./vendor/jsm/postprocessing/UnrealBloomPass.js",
  "./vendor/jsm/postprocessing/OutputPass.js",
  "./vendor/jsm/shaders/CopyShader.js",
  "./vendor/jsm/shaders/LuminosityHighPassShader.js",
  "./vendor/jsm/shaders/OutputShader.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: always prefer fresh files when online (so edits show up),
// fall back to cache when offline. Keeps the cache updated in the background.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
