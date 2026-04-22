/**
 * Minimal PWA service worker.
 *
 * Strategy:
 * - Precache the app shell (HTML, CSS, JS, icons) on install so first-load
 *   after install works offline.
 * - Network-first for navigation + same-origin static assets; fall back to
 *   cache when offline. Never cache /api/* — those are live backend calls.
 * - Bump CACHE_VERSION to invalidate old caches on deploy.
 *
 * This file compiles under the project's DOM lib, so WebWorker globals
 * (ExtendableEvent, FetchEvent, ServiceWorkerGlobalScope, clients) aren't
 * in the type graph. We cast through `unknown` at the boundaries rather than
 * maintain a separate tsconfig for a 50-line file.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SWEvent = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sw = self as unknown as any

const CACHE_VERSION = 'oxygen-web-v1'
// Only precache paths that exist at a stable URL in the built output.
// Fingerprinted assets (/assets/*) get cached lazily by the fetch handler
// below — precaching them would require teaching the SW about the manifest.
const APP_SHELL = ['/', '/index.html', '/icons/icon.png']

sw.addEventListener('install', (event: SWEvent) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache: Cache) => cache.addAll(APP_SHELL))
      .then(() => sw.skipWaiting()),
  )
})

sw.addEventListener('activate', (event: SWEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys: string[]) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
        ),
      )
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener('fetch', (event: SWEvent) => {
  const req: Request = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.pathname.startsWith('/api/')) return
  if (url.origin !== sw.location.origin) return

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches
          .open(CACHE_VERSION)
          .then((cache) => cache.put(req, copy))
          .catch(() => {})
        return res
      })
      .catch(() =>
        caches
          .match(req)
          .then((hit) => hit ?? (caches.match('/index.html') as Promise<Response>)),
      ),
  )
})
