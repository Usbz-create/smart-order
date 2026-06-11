requireAnyRole(['admin', 'cook']);

const salesRows    = document.getElementById('salesRows');
const salesSummary = document.getElementById('salesSummary');
const backLink     = document.getElementById('backLink');
const role         = getRole();

backLink.href        = role === 'admin' ? './admin.html' : './cook.html';
backLink.textContent = role === 'admin' ? 'Back to Admin' : 'Back to Cook';

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSales(data) {
  const rows  = data.rows || [];
  const total = Number(data.totalSales || 0);
  salesSummary.innerHTML = `<p><strong>Total Sales Today:</strong> Rs ${total.toFixed(2)}</p>`;
  if (!rows.length) { salesRows.innerHTML = '<p class="empty">No served orders for today yet.</p>'; return; }
  salesRows.innerHTML = rows.map(r => `<article class="order-card">
    <p><strong>Order ID:</strong> ${Number(r.id)}</p>
    <p><strong>Table:</strong> ${esc(String(r.tableNumber))}</p>
    <p><strong>Order Price:</strong> Rs ${Number(r.totalPrice || 0).toFixed(2)}</p>
    <p><strong>Time:</strong> ${esc(String(r.createdAt))}</p>
  </article>`).join('');
}

async function loadSales() {
  const pin = localStorage.getItem('staffPin_' + role) || '';
  try {
    const r = await fetch('/sales/today', {
      headers: { 'x-admin-pin': pin, 'x-role': role }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    renderSales(d);
  } catch (err) { salesRows.innerHTML = `<p class="empty">${esc(err.message || "Failed to load today's sales.")}</p>`; }
}

loadSales();
setInterval(loadSales, 5000);
