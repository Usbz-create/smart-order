self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));

self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {};
  self.registration.showNotification(d.title || 'Smart Order', {
    body: d.body || 'New notification',
    icon: 'https://cdn-icons-png.flaticon.com/512/857/857681.png',
    requireInteraction: true,
    data: { url: '/waiter.html' }
  });
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
