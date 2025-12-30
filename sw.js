// Service Worker for PWA offline support
const CACHE_NAME = 'trip-planner-v1';
const urlsToCache = [
  './',
  './trips_index.html',
  './itinerary_FUK.html',
  './dollar.html',
  './main.png',
  './manifest.json'
];

// 安裝 Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.log('Cache failed:', err);
      })
  );
  // 立即激活新的 Service Worker
  self.skipWaiting();
});

// 激活 Service Worker，清理舊緩存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // 立即控制所有頁面
  return self.clients.claim();
});

// 攔截網路請求
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果在緩存中找到，返回緩存
        if (response) {
          return response;
        }

        // 否則，發起網路請求
        return fetch(event.request).then(response => {
          // 檢查是否是有效的響應
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // 克隆響應
          const responseToCache = response.clone();

          // 將響應添加到緩存
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });

          return response;
        }).catch(() => {
          // 網路請求失敗時，返回離線頁面（可選）
          // return caches.match('./offline.html');
        });
      })
  );
});
