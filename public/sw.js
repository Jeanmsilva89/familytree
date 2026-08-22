const CACHE = "familytree-static-v2";

function isNavigation(request) {
  return request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
}

function isHtmlPath(pathname) {
  return pathname === "/" || pathname.endsWith(".html") || !pathname.includes(".");
}

function isHashedAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/sw.js") {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  if (isNavigation(event.request) || isHtmlPath(url.pathname) || url.search.includes("_rsc")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (!isHashedAsset(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.ok) cache.put(event.request, response.clone());
          return response;
        });
      }),
    ),
  );
});
