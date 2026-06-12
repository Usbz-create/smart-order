const ROLE_KEY = 'restaurantRole';

// Translates a stored Māori table key (e.g. "moana") to its display number (e.g. "1").
// Falls back to the raw value if not found, so old numeric data still renders.
const TABLE_DISPLAY_MAP = {
  moana:'1',   maunga:'2',  awa:'3',     ngahere:'4',  repo:'5',
  rangi:'6',   whenua:'7',  makau:'8',   roto:'9',     oneone:'10',
  kapua:'11',  hau:'12',    ua:'13',     marama:'14',  ra:'15',
  whetu:'16',  kohu:'17',   ngaru:'18',  pohatu:'19',  toka:'20',
  mania:'21',  puke:'22',   waoku:'23',  raorao:'24',  manga:'25',
  wai:'26',    awaawa:'27', takutai:'28', pari:'29',   ana:'30'
};
function tableLabel(key) {
  return TABLE_DISPLAY_MAP[String(key).trim().toLowerCase()] || String(key);
}

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
  // Store PIN so staff API calls (status updates etc.) can include it
  // It stays in localStorage only for the session; logout clears it
  localStorage.setItem('staffPin_' + role, pin);
  return true;
}

function requireRole(expected) {
  if (getRole() !== expected) window.location.href = './index.html';
}

function requireAnyRole(roles) {
  if (!roles.includes(getRole())) window.location.href = './index.html';
}
