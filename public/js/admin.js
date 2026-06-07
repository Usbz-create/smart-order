requireRole('admin');

const logoutBtn       = document.getElementById('logoutBtn');
const passwordForm    = document.getElementById('passwordForm');
const passwordMessage = document.getElementById('passwordMessage');
const menuMessage     = document.getElementById('menuMessage');
const menuAdminList   = document.getElementById('menuAdminList');
const addItemForm     = document.getElementById('addItemForm');

function getAdminPin() { return document.getElementById('adminPinInput').value.trim(); }

function setMessage(el, text, type) {
  el.className = 'message';
  if (type) el.classList.add(type);
  el.textContent = text;
}

async function loadMenuItems() {
  try {
    const r     = await fetch('/admin/menu');
    const items = await r.json();
    if (!items.length) { menuAdminList.innerHTML = '<p class="empty">No menu items found.</p>'; return; }
    menuAdminList.innerHTML = items.map(item => `<article class="order-card">
      <div class="admin-item-row">
        <input type="text"   value="${item.name}"                          data-name-id="${item.id}" />
        <input type="number" min="0" step="0.01" value="${Number(item.price || 0).toFixed(2)}" data-price-id="${item.id}" />
        <label class="inline-check">
          <input type="checkbox" data-active-id="${item.id}" ${item.isActive ? 'checked' : ''} /> Active
        </label>
        <button data-save-id="${item.id}"   class="secondary">Save</button>
        <button data-delete-id="${item.id}" class="danger">Delete</button>
      </div>
    </article>`).join('');
  } catch { menuAdminList.innerHTML = '<p class="empty">Failed to load menu.</p>'; }
}

passwordForm.addEventListener('submit', async e => {
  e.preventDefault();
  const adminPin = getAdminPin();
  const role     = document.getElementById('targetRole').value;
  const newPin   = document.getElementById('newPinInput').value.trim();
  try {
    const r = await fetch('/admin/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPin, role, newPin })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    setMessage(passwordMessage, d.message, 'ok');
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
  if (!adminPin) { setMessage(menuMessage, 'Enter Admin PIN first.', 'error'); return; }
  const sid = t.dataset.saveId;
  const did = t.dataset.deleteId;
  try {
    if (sid) {
      const n = document.querySelector(`[data-name-id="${sid}"]`).value.trim();
      const p = Number(document.querySelector(`[data-price-id="${sid}"]`).value);
      const a = document.querySelector(`[data-active-id="${sid}"]`).checked;
      const r = await fetch('/admin/menu/' + sid, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin, name: n, price: p, isActive: a })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message);
      setMessage(menuMessage, d.message, 'ok');
    }
    if (did) {
      const r = await fetch('/admin/menu/' + did, {
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

logoutBtn.addEventListener('click', () => { clearRole(); window.location.href = './index.html'; });

loadMenuItems();
