/**
 * pwa.js — Smart Order PWA helper
 * Include this in any page that should support:
 *   - "Install App" banner
 *   - Push notification subscription
 *
 * Usage: <script src="/pwa.js"></script>
 * Optional: set window.VAPID_PUBLIC_KEY before loading this script.
 */

(function () {
  'use strict';

  // ── Service Worker Registration ───────────────────────────────────────────
  let swRegistration = null;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          swRegistration = reg;
          console.log('[PWA] Service Worker registered');
          // Check for waiting SW (new version available)
          if (reg.waiting) notifyUpdate(reg.waiting);
          reg.addEventListener('updatefound', () => {
            const newSW = reg.installing;
            newSW.addEventListener('statechange', () => {
              if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                notifyUpdate(newSW);
              }
            });
          });
        })
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    });
  }

  function notifyUpdate(worker) {
    if (confirm('A new version of Smart Order is available. Refresh now?')) {
      worker.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }

  // ── Install Prompt ────────────────────────────────────────────────────────
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    hideInstallBanner();
    deferredPrompt = null;
    console.log('[PWA] App installed');
  });

  function showInstallBanner() {
    // Don't show if already in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
      <div style="
        position:fixed;bottom:0;left:0;right:0;
        background:#1e2d50;color:#fff;
        display:flex;align-items:center;justify-content:space-between;
        padding:14px 16px;z-index:9999;
        box-shadow:0 -2px 12px rgba(0,0,0,0.3);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      ">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:28px;">🍽️</span>
          <div>
            <div style="font-weight:700;font-size:14px;">Install Smart Order</div>
            <div style="font-size:12px;opacity:0.75;">Add to your home screen for quick access</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <button id="pwa-install-dismiss" style="
            background:transparent;border:1px solid rgba(255,255,255,0.4);
            color:#fff;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px;
          ">Later</button>
          <button id="pwa-install-btn" style="
            background:#3498db;border:none;color:#fff;
            padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;
          ">Install</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').addEventListener('click', () => {
      hideInstallBanner();
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(choice => {
          console.log('[PWA] Install choice:', choice.outcome);
          deferredPrompt = null;
        });
      }
    });

    document.getElementById('pwa-install-dismiss').addEventListener('click', hideInstallBanner);
  }

  function hideInstallBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.remove();
  }

  // ── Push Notification Subscription ───────────────────────────────────────
  /**
   * Call this from your app after user logs in to subscribe to push notifications.
   * Example: SmartOrderPWA.subscribePush()
   */
  window.SmartOrderPWA = {
    /**
     * Request push permission and subscribe.
     * Sends the subscription to POST /api/push/subscribe on your server.
     */
    async subscribePush() {
      if (!swRegistration) {
        console.warn('[PWA] Service Worker not ready yet');
        return null;
      }
      if (!('PushManager' in window)) {
        console.warn('[PWA] Push not supported in this browser');
        return null;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('[PWA] Push permission denied');
        return null;
      }

      try {
        // Use VAPID key if provided, otherwise subscribe without it (for testing)
        const options = { userVisibleOnly: true };
        const vapidKey = window.VAPID_PUBLIC_KEY;
        if (vapidKey) {
          options.applicationServerKey = urlBase64ToUint8Array(vapidKey);
        }

        const subscription = await swRegistration.pushManager.subscribe(options);

        // Send subscription to your server
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription,
            role: localStorage.getItem('restaurantRole') || 'unknown'
          })
        });

        console.log('[PWA] Push subscription saved');
        return subscription;
      } catch (err) {
        console.error('[PWA] Push subscription failed:', err);
        return null;
      }
    },

    /** Unsubscribe from push notifications */
    async unsubscribePush() {
      if (!swRegistration) return;
      const sub = await swRegistration.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
        console.log('[PWA] Unsubscribed from push');
      }
    },

    /** Check if already subscribed */
    async isPushSubscribed() {
      if (!swRegistration) return false;
      const sub = await swRegistration.pushManager.getSubscription();
      return !!sub;
    }
  };

  // Helper: convert VAPID public key
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

})();
