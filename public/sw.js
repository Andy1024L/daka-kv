const CACHE_VERSION = "daka-shell-v20261007-record-sync-v2"

async function deleteOldCaches() {
  const cacheNames = await caches.keys()
  await Promise.all(cacheNames.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)))
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteOldCaches().then(() => self.clients.claim()))
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") {
    self.skipWaiting()
  }
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return
  }

  if (url.pathname.startsWith("/api/")) {
    return
  }

  if (url.pathname === "/version.json") {
    event.respondWith(fetch(request))
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse
        }

        return fetch(request)
          .then((response) => {
            if (response.ok) {
              const responseToCache = response.clone()
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseToCache))
            }

            return response
          })
          .catch(() => caches.match("/"))
      })
    )
    return
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon") || url.pathname === "/manifest.json") {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse

        return fetch(request).then((response) => {
          if (response.ok) {
            const responseToCache = response.clone()
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseToCache))
          }

          return response
        })
      })
    )
  }
})
