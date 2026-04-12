self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  // API 요청은 가로채지 않음
  if (e.request.url.includes('/api/')) return
  e.respondWith(fetch(e.request))
})
