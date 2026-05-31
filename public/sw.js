// ============================================================
// HeelsUp — Service Worker (PWA)
// public/sw.js
// ============================================================

const CACHE_NAME = 'heelsup-v1';
const OFFLINE_URL = '/offline.html';

// ── Files to cache immediately on install ─────────────────────
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/shop.html',
    '/cart.html',
    '/wishlist.html',
    '/style.css',
    '/app-auth.js',
    '/js/api.js',
    '/js/cart.js',
    '/js/auth.js',
    '/js/ui.js',
    '/logo.png',
    '/manifest.json',
];

// ── Install: pre-cache static assets ─────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS.filter(Boolean));
        }).then(() => self.skipWaiting())
    );
});

// ── Activate: clean old caches ────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// ── Fetch: Network-first for API, Cache-first for static ──────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip API calls — always go to network
    if (url.pathname.startsWith('/api/')) return;

    // Skip cross-origin requests (fonts, CDNs)
    if (url.origin !== location.origin) return;

    event.respondWith(
        // Try network first, fallback to cache
        fetch(request)
            .then((response) => {
                // Cache successful responses
                if (response && response.status === 200) {
                    const cloned = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, cloned));
                }
                return response;
            })
            .catch(() => {
                // Network failed — try cache
                return caches.match(request).then(cached => {
                    if (cached) return cached;
                    // For HTML pages, show offline page
                    if (request.headers.get('accept')?.includes('text/html')) {
                        return caches.match('/index.html');
                    }
                });
            })
    );
});

// ── Background sync (for offline cart actions) ────────────────
self.addEventListener('sync', (event) => {
    if (event.tag === 'heelsup-cart-sync') {
        event.waitUntil(syncCartInBackground());
    }
});

async function syncCartInBackground() {
    // Background sync is handled by api.js when online
    console.log('[SW] Background cart sync triggered');
}

// ── Push notifications ────────────────────────────────────────
self.addEventListener('push', (event) => {
    const data = event.data?.json() || {};
    const title = data.title || 'HeelsUp';
    const options = {
        body: data.body || 'You have a new notification',
        icon: data.icon || '/img/icon-192.png',
        badge: data.badge || '/img/icon-72.png',
        image: data.image,
        data: data.url || '/',
        actions: data.actions || [],
        vibrate: [100, 50, 100],
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url === url && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});