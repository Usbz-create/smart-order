let cart = [];
const MAX_ITEMS = 10;
const TABLE_NAME_MAP = {
  un: '1', deux: '2', trois: '3', quatre: '4', cinq: '5',
  six: '6', sept: '7', huit: '8', neuf: '9', dix: '10'
};

// ── Device ID — generated once, persists forever on this device ───────────
function getOrCreateDeviceId() {
  let d = localStorage.getItem('smartorder_device_id');
  if (!d) {
    d = crypto.randomUUID
      ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem('smartorder_device_id', d);
  }
  return d;
}
const deviceId = getOrCreateDeviceId();

// ── Table & session from URL / localStorage ────────────────────────────────
const urlParams   = new URLSearchParams(window.location.search);
const tableFromURL = urlParams.get('table');
if (tableFromURL) {
  const resolved   = TABLE_NAME_MAP[tableFromURL.toLowerCase()] || tableFromURL;
  const storedTable = localStorage.getItem('tableNumber');
  // Fresh QR scan for a different table — drop old session
  if (storedTable && storedTable !== resolved) localStorage.removeItem('sessionId');
  localStorage.setItem('tableNumber', resolved);
}
let tableNumber = localStorage.getItem('tableNumber');
let sessionId   = localStorage.getItem('sessionId') || null;

// ── Init ──────────────────────────────────────────────────────────────────
window.onload = async () => {
  if (!tableNumber) return; // show QR overlay

  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('table-num').innerText = 'Table ' + tableNumber;

  // Validate or clear existing session
  if (sessionId) {
    try {
      const r = await fetch('/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNumber, sessionId, deviceId })
      });
      const d = await r.json();
      if (!d.sessionId) {
        // Session gone (paid/reset) — start fresh
        sessionId = null;
        localStorage.removeItem('sessionId');
      }
    } catch {}
  }

  loadMenu();
  loadTableHistory();
};

// ── Tabs ──────────────────────────────────────────────────────────────────
function showTab(tab, btn) {
  document.getElementById('menu-tab').style.display    = tab === 'menu'    ? 'block' : 'none';
  document.getElementById('history-tab').style.display = tab === 'history' ? 'block' : 'none';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'history') loadTableHistory();
}

// ── Menu ──────────────────────────────────────────────────────────────────
let menuLoaded = false;

async function loadMenu() {
  try {
    const r = await fetch('/menu');
    if (!r.ok) throw new Error();
    const items = await r.json();
    menuLoaded = true;
    const c = document.getElementById('menu-container');
    if (!items.length) { c.innerHTML = '<p style="color:#888;">No items available.</p>'; return; }
    c.innerHTML = items.map(i => `<div class="menu-card">
      <div style="font-size:32px;margin-bottom:6px;">${itemEmoji(i.name)}</div>
      <h4 style="margin:0 0 4px;">${i.name}</h4>
      <p style="margin:0 0 10px;color:#666;">Rs ${Number(i.price).toFixed(2)}</p>
      <button class="btn-add" onclick="addToCart('${i.name}',${i.price})">Add +</button>
    </div>`).join('');
  } catch {
    if (!menuLoaded) setTimeout(loadMenu, 3000);
  }
}

function itemEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes('roll'))     return '&#x1F32F;';
  if (n.includes('momo'))     return '&#x1F95F;';
  if (n.includes('chow') || n.includes('noodle')) return '&#x1F35C;';
  if (n.includes('fries') || n.includes('chips'))  return '&#x1F35F;';
  if (n.includes('chicken'))  return '&#x1F357;';
  if (n.includes('egg'))      return '&#x1F373;';
  if (n.includes('bara'))     return '&#x1FAD3;';
  if (n.includes('fokso'))    return '&#x1F372;';
  if (n.includes('sausage'))  return '&#x1F32D;';
  if (n.includes('tea') || n.includes('coffee') || n.includes('bubble')) return '&#x1F9CB;';
  if (n.includes('coke') || n.includes('fanta') || n.includes('sprite') || n.includes('juice') || n.includes('pani')) return '&#x1F964;';
  if (n.includes('red bull') || n.includes('x-treme')) return '&#x26A1;';
  if (n.includes('kala') || n.includes('refresher')) return '&#x1F379;';
  if (n.includes('topping') || n.includes('sauce') || n.includes('bbq')) return '&#x1F9C2;';
  return '&#x1F37D;';
}

// ── Cart ──────────────────────────────────────────────────────────────────
function totalCartItems() { return cart.reduce((s, i) => s + i.quantity, 0); }

function addToCart(name, price) {
  if (totalCartItems() >= MAX_ITEMS) { alert('⚠️ Maximum ' + MAX_ITEMS + ' items per order.'); return; }
  const ex = cart.find(i => i.name === name);
  if (ex) ex.quantity++; else cart.push({ name, price, quantity: 1 });
  updateCartUI();
  setCartOpen(true);
}

function removeFromCart(i) { cart.splice(i, 1); updateCartUI(); }

function changeQty(i, delta) {
  if (delta > 0 && totalCartItems() >= MAX_ITEMS) { alert('⚠️ Maximum ' + MAX_ITEMS + ' items per order.'); return; }
  cart[i].quantity += delta;
  if (cart[i].quantity <= 0) cart.splice(i, 1);
  updateCartUI();
}

function updateCartUI() {
  let total = 0, count = 0;
  const el = document.getElementById('cart-items');

  if (!cart.length) {
    el.innerHTML = '<p style="color:#888;font-size:14px;">Cart is empty.</p>';
    document.getElementById('cart-total').innerText = 'Rs 0';
    document.getElementById('cart-count').innerText = '0';
    return;
  }

  el.innerHTML = cart.map((item, i) => {
    const lt = item.price * item.quantity;
    total += lt; count += item.quantity;
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:6px;">
      <span style="font-size:14px;flex:1;min-width:0;">${item.name}</span>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <button onclick="changeQty(${i},-1)" style="background:#e74c3c;color:white;border:none;border-radius:6px;width:30px;height:30px;cursor:pointer;font-size:18px;font-weight:bold;display:flex;align-items:center;justify-content:center;">−</button>
        <span style="font-size:15px;font-weight:700;min-width:20px;text-align:center;">${item.quantity}</span>
        <button onclick="changeQty(${i},1)" style="background:#27ae60;color:white;border:none;border-radius:6px;width:30px;height:30px;cursor:pointer;font-size:18px;font-weight:bold;display:flex;align-items:center;justify-content:center;">+</button>
      </div>
      <span style="font-size:13px;min-width:70px;text-align:right;flex-shrink:0;">Rs ${lt.toFixed(2)}</span>
      <button onclick="removeFromCart(${i})" style="color:#e74c3c;border:none;background:none;cursor:pointer;font-size:18px;font-weight:bold;flex-shrink:0;padding:0 4px;">✕</button>
    </div>`;
  }).join('');

  const rem = MAX_ITEMS - count;
  if (rem <= 3) el.innerHTML += `<p style="color:#e67e22;font-size:12px;text-align:center;margin:6px 0 0;">${rem} slot(s) remaining</p>`;

  document.getElementById('cart-total').innerText = 'Rs ' + total.toFixed(2);
  document.getElementById('cart-count').innerText = count;

  // Re-sync page padding if cart panel is open (height may have changed)
  const p = document.getElementById('cart-panel');
  const container = document.querySelector('.container');
  if (p && p.style.display === 'block' && container) {
    requestAnimationFrame(() => { container.style.paddingBottom = (p.offsetHeight + 20) + 'px'; });
  }
}

// Opens/closes cart panel and adjusts page scroll room accordingly
function setCartOpen(open) {
  const p = document.getElementById('cart-panel');
  const container = document.querySelector('.container');
  if (open) {
    p.style.display = 'block';
    requestAnimationFrame(() => {
      if (container) container.style.paddingBottom = (p.offsetHeight + 20) + 'px';
    });
  } else {
    p.style.display = 'none';
    if (container) container.style.paddingBottom = '';
  }
}

function toggleCart() {
  const p = document.getElementById('cart-panel');
  setCartOpen(p.style.display !== 'block');
}

// ── Place Order ───────────────────────────────────────────────────────────
async function placeOrder() {
  if (!cart.length) return alert('Your cart is empty!');
  const btn = document.getElementById('place-order-btn');
  btn.disabled = true; btn.innerText = 'Placing…';
  try {
    const r = await fetch('/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableNumber, items: cart, sessionId, deviceId })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Order failed');
    if (d.sessionId) { sessionId = d.sessionId; localStorage.setItem('sessionId', sessionId); }
    cart = []; updateCartUI();
    setCartOpen(false);
    showTab('history', document.querySelectorAll('.tab-btn')[1]);
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; btn.innerText = 'Place Order'; }
}

// ── Cancel / Edit order ───────────────────────────────────────────────────
async function cancelOrder(orderId) {
  if (!confirm('Cancel this order?')) return;
  try {
    const r = await fetch('/order/' + orderId + '/cancel', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Could not cancel.');
    loadTableHistory();
  } catch (err) { alert(err.message); }
}

async function updateOrderItem(orderId, itemName, delta) {
  try {
    const r = await fetch('/order/' + orderId + '/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemName, delta })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Could not update item.');
    loadTableHistory();
  } catch (err) { alert(err.message); }
}

// ── Call Waiter ───────────────────────────────────────────────────────────
async function callWaiter() {
  if (!sessionId) return alert('Please place a food order first before calling the waiter.');
  const btn = document.getElementById('waiter-btn');
  btn.disabled = true;
  try {
    const r = await fetch('/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableNumber, isCallWaiter: true, sessionId, deviceId })
    });
    if (!r.ok) throw new Error();
    alert('🔔 Waiter is on the way!');
  } catch { alert('Could not notify waiter. Try again.'); }
  finally { setTimeout(() => btn.disabled = false, 5000); }
}

// ── Request Bill ──────────────────────────────────────────────────────────
async function requestBill() {
  const btn = document.getElementById('view-bill-btn');
  if (btn) { btn.disabled = true; btn.innerText = 'Requesting…'; }
  try {
    const r = await fetch('/table/' + tableNumber + '/request-bill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    if (!r.ok) throw new Error();
    loadTableHistory();
  } catch {
    alert('Could not request bill. Try again.');
    if (btn) { btn.disabled = false; btn.innerText = '🧾 View Bill & Pay'; }
  }
}

// ── Table History ─────────────────────────────────────────────────────────
async function loadTableHistory() {
  if (!tableNumber || !sessionId) return;
  try {
    const r = await fetch('/orders/table/' + tableNumber + '?sessionId=' + encodeURIComponent(sessionId));
    if (!r.ok) throw new Error();
    renderHistory(await r.json());
  } catch { setTimeout(loadTableHistory, 3000); }
}

function renderHistory(orders) {
  const preparingDiv = document.getElementById('preparing-list');
  const eatenDiv     = document.getElementById('eaten-list');
  const grandTotalEl = document.getElementById('grand-total');
  const paySection   = document.getElementById('pay-bill-section');

  let preparingHTML = '', eatenHTML = '', grandTotal = 0, hasActive = false;
  const billAlreadyRequested = orders.some(o => o.billRequested === 1);

  orders.forEach(o => {
    if (o.status === 'call_waiter') return;
    if (!Array.isArray(o.items) || o.items.length === 0) return;
    const itemsStr = o.items.map(i => i.name + ' ×' + i.quantity).join(', ');
    const price    = Number(o.totalPrice || 0);

    if (o.status === 'served') {
      grandTotal += price;
      eatenHTML += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
        <span style="flex:1;">${itemsStr} <span class="status-badge status-served">Served 🎉</span></span>
        <span style="font-weight:bold;">Rs ${price.toFixed(2)}</span>
      </div>`;
    } else {
      hasActive = true;
      if (o.status === 'pending') {
        const itemRows = o.items.map(item => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;background:#f9f9f9;padding:6px 10px;border-radius:8px;">
            <span style="flex:1;font-size:14px;">${item.name}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <button onclick="updateOrderItem(${o.id},'${item.name.replace(/'/g, "\\'")}', -1)"
                style="background:#e74c3c;color:white;border:none;border-radius:6px;width:28px;height:28px;font-size:16px;font-weight:bold;cursor:pointer;">−</button>
              <span style="font-weight:700;min-width:16px;text-align:center;">${item.quantity}</span>
              <button onclick="updateOrderItem(${o.id},'${item.name.replace(/'/g, "\\'")}', 1)"
                style="background:#27ae60;color:white;border:none;border-radius:6px;width:28px;height:28px;font-size:16px;font-weight:bold;cursor:pointer;">+</button>
            </div>
            <span style="font-size:13px;min-width:65px;text-align:right;">Rs ${(item.unitPrice * item.quantity).toFixed(2)}</span>
          </div>`).join('');
        preparingHTML += `<div style="margin-bottom:14px;border:1px solid #fdd;border-radius:10px;padding:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span><span class="status-badge status-pending">Pending ⏳</span></span>
            <span style="font-weight:bold;">Rs ${price.toFixed(2)}</span>
          </div>
          ${itemRows}
          <button onclick="cancelOrder(${o.id})" style="margin-top:6px;width:100%;background:#e74c3c;color:white;border:none;border-radius:8px;padding:8px;font-size:13px;font-weight:600;cursor:pointer;">🗑 Cancel Order</button>
        </div>`;
      } else {
        preparingHTML += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
          <span style="flex:1;">${itemsStr} <span class="status-badge status-${o.status}">${statusLabel(o.status)}</span></span>
          <span style="font-weight:bold;">Rs ${price.toFixed(2)}</span>
        </div>`;
      }
    }
  });

  preparingDiv.innerHTML = preparingHTML || '<p style="color:#888;">Nothing preparing right now.</p>';
  eatenDiv.innerHTML     = eatenHTML     || '<p style="color:#888;">No items served yet.</p>';
  grandTotalEl.innerText = grandTotal.toFixed(2);

  if (paySection) {
    if (grandTotal > 0 && !hasActive) {
      if (billAlreadyRequested) {
        paySection.innerHTML = `<div style="text-align:center;padding:24px 16px;background:#f0f4ff;border-radius:12px;margin-top:16px;border:2px solid #c7d2fe;">
          <p style="font-size:40px;margin:0 0 10px;">🧾</p>
          <p style="font-weight:800;color:#4f46e5;font-size:19px;margin:0 0 8px;">📲 Please show this page at the counter</p>
          <p style="color:#888;font-size:12px;margin:0;">Thank you for dining with us! 🙏</p>
        </div>`;
      } else {
        paySection.innerHTML = `<div style="margin-top:20px;">
          <button onclick="requestBill()" id="view-bill-btn"
            style="width:100%;padding:18px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;
                   border:none;border-radius:14px;font-size:18px;font-weight:800;cursor:pointer;
                   box-shadow:0 6px 20px rgba(79,70,229,.4);letter-spacing:.3px;">
            🧾 View Bill & Pay
          </button>
          <p style="color:#888;font-size:12px;text-align:center;margin-top:8px;">Tap to send your bill to the counter</p>
        </div>`;
      }
    } else if (grandTotal > 0 && hasActive) {
      paySection.innerHTML = '<p style="text-align:center;color:#888;font-size:13px;margin-top:12px;">⏳ Waiting for all orders to be served…</p>';
    } else {
      paySection.innerHTML = '';
    }
  }
}

function statusLabel(s) {
  return { pending: 'Pending ⏳', cooking: 'Cooking 🔥', ready: 'Ready ✅', served: 'Served 🎉' }[s] || s;
}

// ── Polling ───────────────────────────────────────────────────────────────
setInterval(() => {
  if (!menuLoaded) loadMenu();
  if (document.getElementById('history-tab').style.display !== 'none') loadTableHistory();
}, 5000);
