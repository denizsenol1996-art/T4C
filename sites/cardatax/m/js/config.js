/* ═══════════════════════════════════════
   CarDatax Mobile — Config & Globals
   ═══════════════════════════════════════ */

// ═══ TOAST NOTIFICATIONS ═══
function toast(msg, type='info', duration=3000) {
  const c = document.getElementById('toastContainer');
  const icons = {success:'✓',error:'✕',warning:'⚠',info:'ℹ'};
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = '<span class="toast-icon">' + (icons[type]||'ℹ') + '</span>' + msg;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, duration);
}

// ═══ NETWORK STATUS ═══
window.addEventListener('offline', () => document.getElementById('offlineBar').classList.add('show'));
window.addEventListener('online', () => { document.getElementById('offlineBar').classList.remove('show'); toast('Weer online', 'success'); });

// ═══ SMART FETCH — catches network errors globally ═══
const _fetch = window.fetch.bind(window);
window.fetch = async function(...args) {
  if (!navigator.onLine) {
    toast('Geen internetverbinding', 'error');
    throw new Error('Offline');
  }
  try {
    const r = await _fetch(...args);
    if (r.status === 401 && _t4cToken()) {
      // Token expired — only if we were logged in
      localStorage.removeItem('t4c_token');
      document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
      document.getElementById('s-login').classList.add('active');
      document.querySelector('.bnav').style.display='none';
      toast('Sessie verlopen, log opnieuw in', 'warning');
      throw new Error('Unauthorized');
    }
    return r;
  } catch(e) {
    if (e.message === 'Unauthorized' || e.message === 'Offline') throw e;
    if (e.name === 'TypeError' && e.message.includes('fetch')) {
      toast('Server niet bereikbaar', 'error');
    }
    throw e;
  }
};

const IC={
  home:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 10l7-7 7 7M5 8.5V16a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V8.5"/></svg>',
  search:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4 4"/></svg>',
  inspect:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 10h6M10 7v6"/></svg>',
  camera:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 5l1-2h6l1 2h3a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1h3z"/><circle cx="10" cy="10.5" r="3"/></svg>',
  list:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h12M4 10h12M4 14h8"/></svg>',
  car:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12l1.5-5h11L17 12"/><rect x="2" y="12" width="16" height="4" rx="1"/><circle cx="5.5" cy="16" r="1.5"/><circle cx="14.5" cy="16" r="1.5"/></svg>',
  chart:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="6" width="3" height="7" rx=".5"/><rect x="5.5" y="3" width="3" height="10" rx=".5"/><rect x="10" y="1" width="3" height="12" rx=".5"/></svg>',
  euro:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M10 3.5A4 4 0 004 7a4 4 0 006 3.5M3 6h5M3 8h5"/></svg>',
  cal:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="11" height="10" rx="1.5"/><path d="M1.5 6h11M4.5 1v3M9.5 1v3"/></svg>',
  fuel:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3" width="7" height="9" rx="1"/><path d="M9 6l2-1v5a1 1 0 01-2 0"/></svg>',
  flag:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 2v10M2 2h8l-2 3 2 3H2"/></svg>',
  weight:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M7 2a2 2 0 00-2 2h4a2 2 0 00-2-2zM3 5h8l-1 7H4L3 5z"/></svg>',
  shield:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M7 1L2 3v4c0 3.5 5 6 5 6s5-2.5 5-6V3L7 1z"/></svg>',
  alert:'<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6 1L1 10h10L6 1zM6 4.5v2.5M6 8.5v.5"/></svg>',
  clock:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="5.5"/><path d="M7 4v3l2 2"/></svg>',
  tool:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8.5 2.5a3 3 0 00-4 4L2 9l1 1 2.5-2.5a3 3 0 004-4l-2 2-1-1 2-2z"/></svg>',
  copy:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4" y="4" width="8" height="8" rx="1"/><path d="M4 10H3a1 1 0 01-1-1V3a1 1 0 011-1h6a1 1 0 011 1v1"/></svg>',
  refresh:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 7a5 5 0 019-3M12 7a5 5 0 01-9 3M11 1v3h-3M3 13v-3h3"/></svg>',
  pen:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z"/></svg>',
  gallery:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="16" height="14" rx="2"/><circle cx="7" cy="8" r="2"/><path d="M2 14l4-4 3 3 4-5 5 6"/></svg>',
  scan:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 6V4a2 2 0 012-2h2M14 2h2a2 2 0 012 2v2M18 14v2a2 2 0 01-2 2h-2M6 18H4a2 2 0 01-2-2v-2"/></svg>',
  doc:'<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 2h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M12 2v4h4M7 10h6M7 13h4"/></svg>',
  share:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="3" cy="7" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="11" cy="11" r="1.5"/><path d="M4.3 6.2l5.4-2.4M4.3 7.8l5.4 2.4"/></svg>',
  web:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="5.5"/><path d="M1.5 7h11M7 1.5c-2 2-2 9 0 11M7 1.5c2 2 2 9 0 11"/></svg>',
  check:'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7l3 3 5-6"/></svg>',
  snap:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
};

let last = null;
let pendingDamageCost = 0, pendingDamageCount = 0;
let vtStyle = 'professioneel';
let recent = JSON.parse(localStorage.getItem('t4c_rec') || '[]');
