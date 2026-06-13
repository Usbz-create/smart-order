requireRole('cook');

const ordersContainer = document.getElementById('ordersContainer');
const logoutBtn       = document.getElementById('logoutBtn');

// ── XSS helper ────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatItems(items) {
  if (!Array.isArray(items) || items.length === 0) return '<li>No items</li>';
  return items.map(i =>
    `<li><strong>${esc(i.name)}</strong> &times; ${Number(i.quantity)} <span style="color:#666;font-size:12px;">(Rs ${Number(i.unitPrice || 0).toFixed(2)} each)</span></li>`
  ).join('');
}

const role = getRole();

async function updateOrderStatus(id, status) {
  const pin = localStorage.getItem('staffPin_' + role);
  const r = await fetch(`/order/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, role, pin })
  });
  if (!r.ok) { const d = await r.json(); throw new Error(d.message || 'Failed to update order.'); }
}

function renderOrders(orders) {
  const cookOrders = orders.filter(o => o.status === 'pending' || o.status === 'cooking');
  if (!cookOrders.length) { ordersContainer.innerHTML = '<p class="empty">✅ All clear — no active orders right now.</p>'; return; }

  const blockedSessions = new Set(orders.filter(o => o.billRequested === 1).map(o => o.sessionId));

  ordersContainer.innerHTML = cookOrders.map(order => {
    const color   = order.status === 'cooking' ? '#e67e22' : '#3498db';
    const label   = order.status === 'cooking' ? '🔥 Cooking' : '⏳ Pending';
    const blocked = blockedSessions.has(order.sessionId);
    const bs      = blocked ? 'opacity:.45;cursor:not-allowed;filter:grayscale(1)' : '';
    const bt      = blocked ? 'title="Customer has requested the bill"' : '';
    return `<article class="order-card" style="border-left:4px solid ${color};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;">
        <div>
          <p style="margin:0 0 2px;"><strong>Order #${Number(order.id)}</strong> — Table <strong>${tableLabel(order.tableNumber)}</strong></p>
          <span class="status-badge" style="background:${color}20;color:${color};border:1px solid ${color}40;">${label}</span>
          ${blocked ? '<span style="display:inline-block;margin-left:8px;background:#fff0f0;color:#c0392b;border:1px solid #f5c6cb;border-radius:6px;font-size:11px;font-weight:700;padding:2px 8px;vertical-align:middle;">🧾 Bill requested</span>' : ''}
        </div>
        <p style="margin:0;font-weight:700;color:#333;">Rs ${Number(order.totalPrice || 0).toFixed(2)}</p>
      </div>
      <p style="margin:12px 0 4px;font-weight:600;font-size:13px;color:#444;">🧾 Items to cook:</p>
      <ul class="order-items" style="margin:0 0 12px;background:#f9f9f9;border-radius:8px;padding:10px 10px 10px 28px;">${formatItems(order.items)}</ul>
      <div class="button-row">
        ${order.status === 'pending' ? `<button class="secondary" data-id="${Number(order.id)}" data-action="cooking" style="${bs}" ${bt} ${blocked ? 'disabled' : ''}>🍳 Start Cooking</button>` : ''}
        <button class="success" data-id="${Number(order.id)}" data-action="ready" style="${bs}" ${bt} ${blocked ? 'disabled' : ''}>✅ Mark Ready</button>
      </div>
    </article>`;
  }).join('');
}

async function loadOrders() {
  try {
    const r = await fetch('/orders');
    if (!r.ok) throw new Error();  // fixed: was missing this check
    const orders = await r.json();
    renderOrders(orders);
  } catch { ordersContainer.innerHTML = '<p class="empty">Failed to load orders. Retrying…</p>'; }
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

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('staffPin_' + role);
  clearRole();
  window.location.href = './index.html';
});

loadOrders();
setInterval(loadOrders, 4000);
