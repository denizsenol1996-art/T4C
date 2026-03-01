/* ═══════════════════════════════════════
   CarDatax Mobile — Core (auth, nav, utils)
   ═══════════════════════════════════════ */
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
    greeting.textContent=userName?g+', '+userName:g;
  }
  total.textContent=recent.length||'0';
  const todayStart=new Date();todayStart.setHours(0,0,0,0);
  const todayCount=recent.filter(r=>r.ts&&r.ts>=todayStart.getTime()).length;
  today.textContent=todayCount;
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

