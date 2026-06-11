const CACHE_NAME    = 'smart-order-v2'; // ⚠ Bump this string on every deploy to bust stale caches
const STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/js/auth.js',
  '/js/customer.js',
  '/js/cook.js',
  '/js/waiter.js',
  '/js/admin.js',
  '/js/counter.js',
  '/js/sales.js',
  '/customer.html',
  '/cook.html',
  '/waiter.html',
  '/admin.html',
  '/counter.html',
  '/sales.html',
  '/index.html',
  '/icons/icon-512.png'
];

// Cache static assets on install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Clean up old caches on activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for API calls; cache-first for static assets; offline fallback
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API routes — always network-first, no caching
  if (url.pathname.startsWith('/order') ||
      url.pathname.startsWith('/menu')  ||
      url.pathname.startsWith('/auth')  ||
      url.pathname.startsWith('/table') ||
      url.pathname.startsWith('/sales') ||
      url.pathname.startsWith('/admin') ||
      url.pathname.startsWith('/manager') ||
      url.pathname.startsWith('/session')) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ message: 'You are offline. Please check your connection.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Static assets — cache-first with network fallback
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Cache valid responses for static assets
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML pages
        if (request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Push notifications
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(d.title || 'Smart Order', {
      body: d.body || 'New notification',
      icon: '/icons/icon-512.png',
      requireInteraction: true,
      data: { url: '/waiter.html' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/waiter.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if (c.url.includes('waiter') && 'focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
