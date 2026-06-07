requireAnyRole(['admin', 'cook']);

const salesRows    = document.getElementById('salesRows');
const salesSummary = document.getElementById('salesSummary');
const backLink     = document.getElementById('backLink');
const role         = getRole();

backLink.href        = role === 'admin' ? './admin.html' : './cook.html';
backLink.textContent = role === 'admin' ? 'Back to Admin' : 'Back to Cook';

function renderSales(data) {
  const rows  = data.rows || [];
  const total = Number(data.totalSales || 0);
  salesSummary.innerHTML = `<p><strong>Total Sales Today:</strong> Rs ${total.toFixed(2)}</p>`;
  if (!rows.length) { salesRows.innerHTML = '<p class="empty">No served orders for today yet.</p>'; return; }
  salesRows.innerHTML = rows.map(r => `<article class="order-card">
    <p><strong>Order ID:</strong> ${r.id}</p>
    <p><strong>Table:</strong> ${r.tableNumber}</p>
    <p><strong>Order Price:</strong> Rs ${Number(r.totalPrice || 0).toFixed(2)}</p>
    <p><strong>Time:</strong> ${r.createdAt}</p>
  </article>`).join('');
}

async function loadSales() {
  try {
    const r = await fetch('/sales/today');
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    renderSales(d);
  } catch { salesRows.innerHTML = '<p class="empty">Failed to load today\'s sales.</p>'; }
}

loadSales();
setInterval(loadSales, 5000);
