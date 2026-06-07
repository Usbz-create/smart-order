requireRole('waiter');

const ordersContainer = document.getElementById('ordersContainer');
const logoutBtn       = document.getElementById('logoutBtn');

// ── PWA / install prompt ──────────────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const b = document.getElementById('install-banner');
  if (b) b.style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const b = document.getElementById('install-banner');
  if (b) b.style.display = 'none';
  localStorage.setItem('pwaInstalled', '1');
});

if (window.matchMedia('(display-mode:standalone)').matches || localStorage.getItem('pwaInstalled')) {
  window.addEventListener('load', () => {
    const b = document.getElementById('install-banner');
    if (b) b.style.display = 'none';
  });
}

function installApp() {
  if (!deferredInstallPrompt) { alert('Tap the 3-dot menu → "Add to Home screen"'); return; }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(() => {
    deferredInstallPrompt = null;
    const b = document.getElementById('install-banner');
    if (b) b.style.display = 'none';
  });
}

// ── Service worker ────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(r => console.log('SW:', r.scope))
    .catch(e => console.log('SW fail:', e));
}

// ── Notifications ─────────────────────────────────────────────────────────
function checkNotificationBanner() {
  const b = document.getElementById('notif-banner');
  if (!b) return;
  if (!('Notification' in window)) {
    b.innerHTML = '<span style="font-size:13px;color:#666;">⚠️ Notifications not supported.</span>';
  } else if (Notification.permission === 'granted') {
    b.style.display = 'none';
  }
}

function enableNotifications() {
  if (!('Notification' in window)) { alert('Notifications not supported.'); return; }
  if (Notification.permission === 'denied') {
    alert('Notifications blocked!\n\nTap the lock icon → Notifications → Allow');
    return;
  }
  Notification.requestPermission().then(p => {
    const b = document.getElementById('notif-banner');
    if (p === 'granted') {
      if (b) b.style.display = 'none';
      showToast('✅ Notifications enabled!', '#27ae60');
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(r => r.showNotification('Smart Order ✅', {
          body: 'Notifications working!',
          icon: 'https://cdn-icons-png.flaticon.com/512/857/857681.png',
          requireInteraction: false
        }));
      }
    } else if (b) {
      b.innerHTML = '<span style="font-size:13px;color:#c00;">❌ Blocked. Tap 🔒 lock → Notifications → Allow.</span>';
    }
  });
}

function sendBrowserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(r => r.showNotification(title, {
      body,
      icon: 'https://cdn-icons-png.flaticon.com/512/857/857681.png',
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: '/waiter.html' }
    }));
  } else {
    new Notification(title, { body });
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────
function showToast(msg, color = '#e67e22') {
  const ex = document.getElementById('waiter-toast');
  if (ex) ex.remove();
  const t = document.createElement('div');
  t.id = 'waiter-toast';
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(200px);background:${color};color:white;padding:16px 24px;border-radius:12px;font-weight:700;font-size:15px;z-index:9999;transition:transform .4s ease;box-shadow:0 4px 20px rgba(0,0,0,.3);max-width:90%;text-align:center;`;
  document.body.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => { t.style.transform = 'translateX(-50%) translateY(0)'; }));
  setTimeout(() => {
    t.style.transform = 'translateX(-50%) translateY(200px)';
    t.addEventListener('transitionend', () => t.remove(), { once: true });
  }, 7000);
}

// ── Order tracking ────────────────────────────────────────────────────────
let knownReadyIds  = new Set();
let knownWaiterIds = new Set();
let isFirstLoad    = true;

function formatItems(items) {
  return items.map(i =>
    `<li>${i.name} x ${i.quantity} (Rs ${Number(i.unitPrice || 0).toFixed(2)} each)</li>`
  ).join('');
}

async function updateOrderStatus(id, status) {
  const r = await fetch('/order/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  if (!r.ok) { const d = await r.json(); throw new Error(d.message || 'Failed to update.'); }
}

function checkForNewOrders(orders) {
  const ready  = orders.filter(o => o.status === 'ready');
  const waiter = orders.filter(o => o.status === 'call_waiter');
  if (!isFirstLoad) {
    for (const o of ready)  if (!knownReadyIds.has(String(o.id)))  { const m = '🍽️ Order #' + o.id + ' — Table ' + o.tableNumber + ' is ready!'; sendBrowserNotification('Order Ready! 🍽️', m); showToast(m, '#27ae60'); }
    for (const o of waiter) if (!knownWaiterIds.has(String(o.id))) { const m = '🔔 Table ' + o.tableNumber + ' is calling for the waiter!'; sendBrowserNotification('Waiter Needed! 🔔', m); showToast(m, '#e67e22'); }
  }
  knownReadyIds  = new Set(ready.map(o => String(o.id)));
  knownWaiterIds = new Set(waiter.map(o => String(o.id)));
  isFirstLoad    = false;
}

function renderOrders(orders) {
  const waiterCalls = orders.filter(o => o.status === 'call_waiter');
  const readyOrders = orders.filter(o => o.status === 'ready');
  let html = '';

  if (waiterCalls.length > 0) {
    html += '<h3 style="color:#e67e22;margin:0 0 12px;">🔔 Waiter Calls</h3>';
    html += waiterCalls.map(o =>
      `<article class="order-card" style="border-left:4px solid #e67e22;background:#fffbf0;">
        <p style="font-size:18px;font-weight:700;margin:0 0 4px;">🔔 Waiter Needed!</p>
        <p style="margin:4px 0;"><strong>Table:</strong> ${o.tableNumber}</p>
        <div class="button-row" style="margin-top:10px;">
          <button class="ghost" data-id="${o.id}" data-action="served" style="font-size:13px;padding:6px 14px;">✓ Acknowledged</button>
        </div>
      </article>`
    ).join('');
  }

  if (readyOrders.length > 0) {
    html += '<h3 style="color:#27ae60;margin:16px 0 12px;">🍽️ Ready to Serve</h3>';
    html += readyOrders.map(o =>
      `<article class="order-card" style="border-left:4px solid #27ae60;">
        <p><strong>Order #${o.id}</strong> — Table <strong>${o.tableNumber}</strong></p>
        <p><strong>Total:</strong> Rs ${Number(o.totalPrice || 0).toFixed(2)}</p>
        <ul class="order-items">${formatItems(o.items)}</ul>
        <button class="success" data-id="${o.id}" data-action="served">✅ Mark Served</button>
      </article>`
    ).join('');
  }

  ordersContainer.innerHTML = html || '<p class="empty">✅ All clear — nothing to do right now.</p>';
}

async function loadOrders() {
  try {
    const r = await fetch('/orders');
    if (!r.ok) throw new Error();
    const orders = await r.json();
    checkForNewOrders(orders);
    renderOrders(orders);
  } catch { setTimeout(loadOrders, 3000); }
}

ordersContainer.addEventListener('click', async e => {
  const t = e.target.closest('button[data-id]');
  if (!t) return;
  const id = t.dataset.id, status = t.dataset.action;
  if (!id || !status) return;
  t.disabled = true;
  try { await updateOrderStatus(id, status); await loadOrders(); }
  catch (err) { alert(err.message); t.disabled = false; }
});

logoutBtn.addEventListener('click', () => { clearRole(); window.location.href = '/index.html'; });

checkNotificationBanner();
loadOrders();
setInterval(loadOrders, 4000);
