const ROLE_KEY = 'restaurantRole';

function setRole(r)   { localStorage.setItem(ROLE_KEY, r); }
function clearRole()  { localStorage.removeItem(ROLE_KEY); }
function getRole()    { return localStorage.getItem(ROLE_KEY); }

async function loginWithPin(role, pin) {
  const r = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, pin })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || 'Login failed.');
  setRole(role);
  return true;
}

function requireRole(expected) {
  if (getRole() !== expected) window.location.href = './index.html';
}

function requireAnyRole(roles) {
  if (!roles.includes(getRole())) window.location.href = './index.html';
}
