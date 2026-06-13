requireRole('admin');

const logoutBtn       = document.getElementById('logoutBtn');
const passwordForm    = document.getElementById('passwordForm');
const passwordMessage = document.getElementById('passwordMessage');
const menuMessage     = document.getElementById('menuMessage');
const menuAdminList   = document.getElementById('menuAdminList');
const addItemForm     = document.getElementById('addItemForm');
const role            = getRole();

function getAdminPin() { return localStorage.getItem('staffPin_' + role) || ''; }

function setMessage(el, text, type) {
  el.className = 'message';
  if (type) el.classList.add(type);
  el.textContent = text;
}

async function loadMenuItems() {
  const adminPin = getAdminPin();
  try {
    const r = await fetch('/admin/menu', {
      headers: { 'x-admin-pin': adminPin }
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.message); }
    const items = await r.json();
    if (!items.length) {
      menuAdminList.innerHTML = '<p style="padding:20px 24px;color:#888;font-size:14px;">No menu items yet. Add one above.</p>';
      return;
    }
    menuAdminList.innerHTML = `
      <table class="menu-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item Name</th>
            <th>Price (Rs)</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, i) => `
          <tr>
            <td data-label="#" style="color:var(--slate);font-size:12px;font-weight:600;">${i + 1}</td>
            <td data-label="Item Name"><input type="text" value="${esc(item.name)}" data-name-id="${Number(item.id)}" style="min-width:160px;" /></td>
            <td data-label="Price (Rs)"><input type="number" min="0" step="0.01" value="${Number(item.price || 0).toFixed(2)}" data-price-id="${Number(item.id)}" style="width:100px;" /></td>
            <td data-label="Status">
              <button class="badge ${item.isActive ? 'badge-active' : 'badge-inactive'}" data-active-id="${Number(item.id)}" data-active-val="${item.isActive ? 1 : 0}">
                ${item.isActive ? '✓ Active' : '○ Inactive'}
              </button>
            </td>
            <td data-label="Actions">
              <div class="actions-cell">
                <button class="btn btn-success btn-sm" data-save-id="${Number(item.id)}">Save</button>
                <button class="btn btn-danger btn-sm" data-delete-id="${Number(item.id)}">Delete</button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    // Toggle active badge click
    menuAdminList.querySelectorAll('[data-active-id]').forEach(badge => {
      badge.addEventListener('click', () => {
        const cur = Number(badge.dataset.activeVal);
        const next = cur === 1 ? 0 : 1;
        badge.dataset.activeVal = next;
        badge.className = 'badge ' + (next ? 'badge-active' : 'badge-inactive');
        badge.textContent = next ? '✓ Active' : '○ Inactive';
      });
    });

  } catch (err) { menuAdminList.innerHTML = `<p style="padding:20px 24px;color:var(--red);font-size:14px;">${esc(err.message || 'Failed to load menu.')}</p>`; }
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

passwordForm.addEventListener('submit', async e => {
  e.preventDefault();
  const adminPin = getAdminPin();
  const role2    = document.getElementById('targetRole').value;
  const newPin   = document.getElementById('newPinInput').value.trim();
  try {
    const r = await fetch('/admin/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPin, role: role2, newPin })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    setMessage(passwordMessage, d.message, 'ok');
    // If admin changed their own PIN, update stored PIN so future requests still work
    if (role2 === 'admin') localStorage.setItem('staffPin_admin', newPin);
    passwordForm.reset();
  } catch (err) { setMessage(passwordMessage, err.message, 'error'); }
});

addItemForm.addEventListener('submit', async e => {
  e.preventDefault();
  const adminPin = getAdminPin();
  const name     = document.getElementById('newItemName').value.trim();
  const price    = Number(document.getElementById('newItemPrice').value);
  if (!name || isNaN(price) || price < 0) { setMessage(menuMessage, 'Name and valid price required.', 'error'); return; }
  try {
    const r = await fetch('/admin/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPin, name, price })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    setMessage(menuMessage, d.message, 'ok');
    addItemForm.reset();
    await loadMenuItems();
  } catch (err) { setMessage(menuMessage, err.message, 'error'); }
});

menuAdminList.addEventListener('click', async e => {
  const t = e.target;
  if (!(t instanceof HTMLButtonElement)) return;
  const adminPin = getAdminPin();
  if (!adminPin) { setMessage(menuMessage, 'Session expired. Please log in again.', 'error'); return; }
  const sid = t.dataset.saveId;
  const did = t.dataset.deleteId;
  try {
    if (sid) {
      const n = document.querySelector(`[data-name-id="${sid}"]`).value.trim();
      const p = Number(document.querySelector(`[data-price-id="${sid}"]`).value);
      const a = Number(document.querySelector(`[data-active-id="${sid}"]`).dataset.activeVal) === 1;
      const r = await fetch('/admin/menu/' + Number(sid), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin, name: n, price: p, isActive: a })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message);
      setMessage(menuMessage, d.message, 'ok');
    }
    if (did) {
      if (!confirm('Delete this menu item? This cannot be undone.')) return;
      const r = await fetch('/admin/menu/' + Number(did), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message);
      setMessage(menuMessage, d.message, 'ok');
    }
    await loadMenuItems();
  } catch (err) { setMessage(menuMessage, err.message, 'error'); }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('staffPin_admin');
  clearRole();
  window.location.href = './index.html';
});

loadMenuItems();
