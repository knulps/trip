// PWA 설치 요건을 채우기 위한 최소 service worker.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// fetch 핸들러는 일부러 두지 않는다.
// 예전에는 fetch 를 가로채 그대로 fetch() 로 넘기기만 했는데(pass-through),
// 얻는 것 없이 모든 요청을 service worker 로 우회시켜 브라우저의 캐시와
// preload 경로를 무력화하고, 네트워크가 잠깐 끊기면 원인을 알 수 없는 실패로
// 바뀌기만 했다. fetch 핸들러가 없어도 PWA 설치에는 문제가 없다.
// 나중에 오프라인 지원이 필요해지면 그때 제대로 된 캐시 전략(precache +
// navigation fallback)을 넣는다.
