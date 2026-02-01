const CACHE_NAME = 'di-security-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/css/employee.css',
    '/js/employee-app.js',
    '/images/logo.svg',
    'https://unpkg.com/html5-qrcode'
];

// Установка: кешируем ресурсы
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

// Активация: очистка старых кешей
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
    // Для API запросов не используем кеш (всегда идем в сеть, 
    // а оффлайн-логику обработаем в самом JS коде приложения)
    if (event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request);
        })
    );
});
