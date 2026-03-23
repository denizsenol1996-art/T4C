
// CarDatax Core — toast, login, nav, home, helpers
// Auto-generated from app refactor

// roundRect polyfill
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r) {
    if (typeof r === 'number') r = {tl:r,tr:r,br:r,bl:r}
    this.beginPath(); this.moveTo(x+r.tl,y); this.lineTo(x+w-r.tr,y); this.quadraticCurveTo(x+w,y,x+w,y+r.tr)
    this.lineTo(x+w,y+h-r.br); this.quadraticCurveTo(x+w,y+h,x+w-r.br,y+h); this.lineTo(x+r.bl,y+h)
    this.quadraticCurveTo(x,y+h,x,y+h-r.bl); this.lineTo(x,y+r.tl); this.quadraticCurveTo(x,y,x+r.tl,y); this.closePath()
  }
}


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
const _t4cToken = () => localStorage.getItem('t4c_token') || '';
const _authH = () => ({'Content-Type':'application/json','Authorization':'Bearer '+_t4cToken()});

async function doLogin(){
  const user=document.getElementById('login-user').value.trim();
  const pass=document.getElementById('login-pass').value;
  const errEl=document.getElementById('login-error');
  const btn=document.getElementById('login-btn');
  errEl.style.display='none';
  if(!user||!pass){errEl.textContent='Vul gebruikersnaam en wachtwoord in';errEl.style.display='block';return}
  btn.disabled=true;btn.textContent='Inloggen...';
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password:pass})});
    const d=await r.json();
    if(d.token){
      localStorage.setItem('t4c_token',d.token);
      if(d.user?.name)localStorage.setItem('t4c_user',d.user.name);
      document.getElementById('s-login').classList.remove('active');
      document.querySelector('.bnav').style.display='flex';
      go('home');
      toast('Welkom'+((d.user?.name)?' '+d.user.name:'')+'!','success');
    }else{
      errEl.textContent=d.error||'Inloggen mislukt';errEl.style.display='block';
    }
  }catch(e){
    errEl.textContent='Server niet bereikbaar';errEl.style.display='block';
  }
  btn.disabled=false;btn.textContent='Inloggen';
}

function fmtP(p) {
  const s = p.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 5 || s.length > 6) return s;
  // All 14 Dutch sidecode formats
  const pts = [
    /^([A-Z]{2})(\d{2})(\d{2})$/,       // 1: XX-99-99
    /^(\d{2})(\d{2})([A-Z]{2})$/,       // 2: 99-99-XX
    /^(\d{2})([A-Z]{2})(\d{2})$/,       // 3: 99-XX-99
    /^([A-Z]{2})(\d{2})([A-Z]{2})$/,    // 4: XX-99-XX
    /^([A-Z]{2})([A-Z]{2})(\d{2})$/,    // 5: XX-XX-99
    /^(\d{2})([A-Z]{2})([A-Z]{2})$/,    // 6: 99-XX-XX
    /^(\d{2})([A-Z]{3})(\d{1})$/,       // 7: 99-XXX-9
    /^(\d{1})([A-Z]{3})(\d{2})$/,       // 8: 9-XXX-99
    /^([A-Z]{2})(\d{3})([A-Z]{1})$/,    // 9: XX-999-X
    /^([A-Z]{1})(\d{3})([A-Z]{2})$/,    // 10: X-999-XX
    /^([A-Z]{3})(\d{2})([A-Z]{1})$/,    // 11: XXX-99-X
    /^([A-Z]{1})(\d{2})([A-Z]{3})$/,    // 12: X-99-XXX
    /^(\d{1})([A-Z]{2})(\d{3})$/,       // 13: 9-XX-999
    /^(\d{3})([A-Z]{2})(\d{1})$/,       // 14: 999-XX-9
  ];
  for (const r of pts) { const m = s.match(r); if (m) return m[1]+'-'+m[2]+'-'+m[3]; }
  return s.length===6 ? s.slice(0,3)+'-'+s.slice(3,5)+'-'+s.slice(5) : s.slice(0,2)+'-'+s.slice(2,4)+'-'+s.slice(4);
}
function N(n){return n!=null?Number(n).toLocaleString('nl-NL'):'—'}
function E(n){return n!=null?'€'+Number(n).toLocaleString('nl-NL'):'—'}

function go(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('s-'+id)?.classList.add('active');
  // New nav order: recent(info) | taxatie | home(logo) | walkaround | profiel
  document.querySelectorAll('.bnav-item').forEach((n,i)=>n.classList.toggle('active',['recent','taxatie','home','walkaround','profiel'][i]===id));
  if(id==='home') updateHome();
  if(id==='recent') renderRecent();
  if(id==='taxatie') renderRecentChips();
  if(id==='profiel') updateProfiel();
  if(id==='walkaround' && last?.plate) {
    document.getElementById('wa-plate').value = last.plate;
  }
  if(id==='verkooptekst' && last?.r) {
    const vtPrijs = document.getElementById('vt-prijs');
    if(!vtPrijs.value) vtPrijs.value = last.r.verkoopadviees || last.r.internetPrijs || '';
  }
  // Hydrate SVG icons
  requestAnimationFrame(()=>{
    const m={'hic-tax':IC.doc,'hic-scan':IC.scan,'hic-foto':IC.gallery,'hic-insp':IC.inspect,'hic-vt':IC.pen,
      'fi-cam':IC.camera,'fi-gal':IC.gallery,'wa-snap-ic':IC.snap,'vt-hicon':IC.pen,
      'scan-cam-btn':IC.scan,'vt-copy-btn':IC.copy,'vt-retry-btn':IC.refresh};
    for(const[id,svg] of Object.entries(m)){const el=document.getElementById(id);if(el&&!el.querySelector('svg'))el.innerHTML=svg+' '+(el.textContent||'')}
  });
  if(id==='scan') startScanCam();
}

// ═══ HOME DASHBOARD ═══
function updateHome(){
  const total=document.getElementById('hs-total');
  const today=document.getElementById('hs-today');
  const wrap=document.getElementById('home-last-wrap');
  const userName=localStorage.getItem('t4c_user');
  const greeting=document.getElementById('home-greeting');
  if(greeting){
    const h=new Date().getHours();
    const g=h<12?'Goedemorgen':h<18?'Goedemiddag':'Goedenavond';
    let displayName=userName;try{const u=JSON.parse(userName);displayName=u.name||u.username||userName;}catch(e){}greeting.textContent=displayName?g+', '+displayName:g;
  }
  total.textContent=recent.length||'0';
  const todayStart=new Date();todayStart.setHours(0,0,0,0);
  const todayCount=recent.filter(r=>r.ts&&r.ts>=todayStart.getTime()).length;
  today.textContent=todayCount;
  const todayInline=document.getElementById('hs-today-inline');if(todayInline)todayInline.textContent=todayCount+' vandaag';
  if(recent.length>0){
    const last=recent[0];
    wrap.innerHTML=`<div class="home-section-title">Laatste taxatie</div><div class="home-last" onclick="document.getElementById('mp').value='${last.plate.replace(/-/g,'')}';go('taxatie')"><div><div class="home-last-plate">${fmtP(last.plate)}</div><div class="home-last-info">${last.make||''} ${last.model||''} · ${last.year||''}</div></div><div class="home-last-price">${last.bod?E(last.bod):''}</div></div>`;
  } else {
    wrap.innerHTML='';
  }
}
// Init home on load
requestAnimationFrame(()=>updateHome());

function renderRecentChips(){
  const el=document.getElementById('recent-chips');
  if(!recent.length){el.innerHTML='';return}
  el.innerHTML=recent.slice(0,5).map(r=>
    `<button class="recent-chip" onclick="document.getElementById('mp').value='${r.plate.replace(/-/g,'')}';document.getElementById('mp').dispatchEvent(new Event('input'))">${fmtP(r.plate)}</button>`
  ).join('');
}

function doLogout(){
  localStorage.removeItem('t4c_token');
  localStorage.removeItem('t4c_user');
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('s-login').classList.add('active');
  document.querySelector('.bnav').style.display='none';
  toast('Uitgelogd','info');
}

function ldStep(n){
  for(let i=1;i<=4;i++){
    const el=document.getElementById('lds'+i);
    if(!el) continue;
    if(i<n)el.className='ld-step done';
    else if(i===n)el.className='ld-step active';
    else el.className='ld-step';
  }
}

// ═══ DESKTOP DASHBOARD LOADERS ═══
function loadDashboard(type) {
  // TODO: open dashboard pages
  toast('Dashboard ' + type + ' — binnenkort beschikbaar', 'info');
}

function loadDashboardStats() {
  if (window.innerWidth < 768) return; // Skip on mobile
  
  // Voorraad
  fetch('/api/dashboard/voorraad', {headers: _authH()}).then(r=>r.json()).then(d => {
    if (d.ok) {
      var el = document.getElementById('dash-voorraad-count');
      if (el) el.textContent = d.voorraad.aantal || '0';
      var el2 = document.getElementById('dash-maand-winst');
      if (el2) el2.textContent = d.verkocht_maand.winst ? '\u20ac' + Math.round(d.verkocht_maand.winst).toLocaleString('nl-NL') : '\u20ac0';
    }
  }).catch(()=>{});

  // Inkoop
  fetch('/api/inkoop', {headers: _authH()}).then(r=>r.json()).then(d => {
    if (d.ok) {
      var el = document.getElementById('dash-inkoop-count');
      if (el) el.textContent = d.count || '0';
    }
  }).catch(()=>{});

  // Leads
  fetch('/api/leads', {headers: _authH()}).then(r=>r.json()).then(d => {
    if (d.ok) {
      var el = document.getElementById('dash-leads-count');
      if (el) el.textContent = d.count || '0';
    }
  }).catch(()=>{});

  // Reprice
  fetch('/api/dashboard/reprice', {headers: _authH()}).then(r=>r.json()).then(d => {
    if (d.ok) {
      var el = document.getElementById('dash-reprice-count');
      if (el) el.textContent = d.count || '0';
    }
  }).catch(()=>{});
}

// Auto-load on desktop
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { setTimeout(loadDashboardStats, 1000); });
} else {
  setTimeout(loadDashboardStats, 1000);
}
