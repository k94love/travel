var CACHE_NAME = 'fukuoka-trip-v3';
var urlsToCache = [
    './',
    './index.html',
    './calc.html',
    './translate.html',
    './css/style.css',
    './css/translate.css',
    './js/app.js',
    './js/calc.js',
    './js/translate.js',
    './main.png',
    'https://code.jquery.com/jquery-3.7.1.min.js',
    'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700;900&family=Poppins:wght@400;600;700;800&display=swap'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(urlsToCache);
        })
    );
});

self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request).then(function(response) {
            return response || fetch(event.request);
        })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.filter(function(name) {
                    return name !== CACHE_NAME;
                }).map(function(name) {
                    return caches.delete(name);
                })
            );
        })
    );
});
