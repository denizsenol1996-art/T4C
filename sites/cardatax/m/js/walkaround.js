/* ═══════════════════════════════════════
   CarDatax Mobile — Walkaround & Inspectie
   ═══════════════════════════════════════ */
// ═══ WALK-AROUND 360° INSPECTIE ═══
let waStream = null;
let waPos = 0;
const posNames = ['VOORKANT','RECHTS-VOOR','RECHTS','RECHTS-ACHTER','ACHTERKANT','LINKS-ACHTER','LINKS','LINKS-VOOR'];
const posAngles = ['0°','45°','90°','135°','180°','225°','270°','315°'];
const posDone = [false,false,false,false,false,false,false,false];
let waFrames = [];
let damages = [];
let currentDmgZone = '';
let currentDmgX = 0, currentDmgY = 0;

// Car silhouette SVGs for each angle (simplified outlines)
const carSilhouettes = [
  // 0° Front
  '<svg viewBox="0 0 200 150"><path d="M40,130 L40,80 Q40,55 60,45 L80,35 Q100,28 120,35 L140,45 Q160,55 160,80 L160,130 Z" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="55" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/><ellipse cx="145" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/><rect x="65" y="55" width="70" height="35" rx="5" fill="none" stroke="currentColor" opacity=".5"/></svg>',
  // 45° Front-Right
  '<svg viewBox="0 0 200 150"><path d="M30,130 L35,70 Q45,45 75,35 L130,30 Q160,35 170,60 L175,130 Z" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="50" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/><ellipse cx="155" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/></svg>',
  // 90° Right
  '<svg viewBox="0 0 200 150"><path d="M20,130 L20,85 Q25,70 45,65 L65,45 Q100,35 140,45 L160,65 Q175,70 180,85 L180,130 Z" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="45" cy="120" rx="18" ry="10" fill="none" stroke="currentColor"/><ellipse cx="155" cy="120" rx="18" ry="10" fill="none" stroke="currentColor"/><rect x="55" y="50" width="90" height="30" rx="5" fill="none" stroke="currentColor" opacity=".5"/></svg>',
  // 135° Rear-Right
  '<svg viewBox="0 0 200 150"><path d="M25,130 L30,60 Q40,35 70,30 L125,35 Q155,45 165,70 L170,130 Z" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="45" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/><ellipse cx="150" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/></svg>',
  // 180° Rear
  '<svg viewBox="0 0 200 150"><path d="M40,130 L40,75 Q40,50 60,42 L80,35 Q100,30 120,35 L140,42 Q160,50 160,75 L160,130 Z" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="55" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/><ellipse cx="145" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/><rect x="60" cy="45" width="80" height="25" rx="3" fill="none" stroke="currentColor" opacity=".5"/></svg>',
  // 225° Rear-Left
  '<svg viewBox="0 0 200 150"><path d="M30,130 L35,70 Q45,35 75,30 L130,35 Q160,45 170,60 L175,130 Z" fill="none" stroke="currentColor" stroke-width="2" transform="scale(-1,1) translate(-200,0)"/><ellipse cx="50" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/><ellipse cx="155" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/></svg>',
  // 270° Left
  '<svg viewBox="0 0 200 150"><path d="M20,130 L20,85 Q25,70 45,65 L65,45 Q100,35 140,45 L160,65 Q175,70 180,85 L180,130 Z" fill="none" stroke="currentColor" stroke-width="2" transform="scale(-1,1) translate(-200,0)"/><ellipse cx="45" cy="120" rx="18" ry="10" fill="none" stroke="currentColor"/><ellipse cx="155" cy="120" rx="18" ry="10" fill="none" stroke="currentColor"/></svg>',
  // 315° Front-Left
  '<svg viewBox="0 0 200 150"><path d="M25,130 L30,60 Q40,35 70,30 L125,35 Q155,45 165,70 L170,130 Z" fill="none" stroke="currentColor" stroke-width="2" transform="scale(-1,1) translate(-200,0)"/><ellipse cx="45" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/><ellipse cx="150" cy="120" rx="15" ry="10" fill="none" stroke="currentColor"/></svg>'
];

// Typical NL repair costs per damage type + severity
const COSTS = {
  kras:       { licht: [75,150],  gemiddeld: [150,300], ernstig: [300,600] },
  deuk:       { licht: [50,120],  gemiddeld: [120,300], ernstig: [300,600] },
  lakschade:  { licht: [150,300], gemiddeld: [300,600], ernstig: [600,1200] },
  roest:      { licht: [200,400], gemiddeld: [400,800], ernstig: [800,1500] },
  bumper:     { licht: [100,250], gemiddeld: [250,500], ernstig: [500,900] },
  ruit:       { licht: [75,150],  gemiddeld: [150,350], ernstig: [350,700] },
  spiegel:    { licht: [50,100],  gemiddeld: [100,250], ernstig: [250,400] },
  velg:       { licht: [50,100],  gemiddeld: [100,250], ernstig: [250,500] }
};

async function startWalkaround() {
  const plate = document.getElementById('wa-plate').value;
  if (!plate || plate.replace(/[^a-zA-Z0-9]/g,'').length < 5) return toast('Voer kenteken in','warning');

  document.getElementById('wa-start').style.display = 'none';
  document.getElementById('wa-camera').style.display = 'block';
  document.getElementById('wa-map').style.display = 'none';

  waFrames = []; damages = [];
  document.getElementById('wa-frames').innerHTML = '';
  posDone.fill(false);
  setPos(0);
  updateCaptureProgress();

  try {
    waStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    document.getElementById('waVideo').srcObject = waStream;
  } catch (e) { toast('Camera niet beschikbaar','error'); }
}

function stopInspCam() {
  if (waStream) { waStream.getTracks().forEach(t => t.stop()); waStream = null; }
  document.getElementById('wa-start').style.display = 'block';
  document.getElementById('wa-camera').style.display = 'none';
  document.getElementById('wa-map').style.display = 'none';
}

function setPos(i) {
  waPos = i;
  document.getElementById('wa-angle-label').textContent = posNames[i] + ' (' + posAngles[i] + ')';
  document.getElementById('wa-silhouette').innerHTML = carSilhouettes[i] || '';
  document.querySelectorAll('.wa-pos-btn').forEach((b, j) => {
    b.classList.toggle('active', j === i);
    b.classList.toggle('done', posDone[j]);
  });
  updateCaptureProgress();
}

function updateCaptureProgress(){
  const el=document.getElementById('wa-progress');
  if(!el)return;
  el.innerHTML=posNames.map((_,i)=>'<div class="capture-dot'+(posDone[i]?' done':'')+(i===waPos?' current':'')+'">'+
    (posDone[i]?'✓':(i+1))+'</div>').join('');
}

function captureFrame() {
  const video = document.getElementById('waVideo');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const url = canvas.toDataURL('image/jpeg', 0.8);

  waFrames.push({ pos: waPos, name: posNames[waPos], angle: posAngles[waPos], url });
  posDone[waPos] = true;

  const el = document.getElementById('wa-frames');
  el.innerHTML += `<div class="wa-frame"><img src="${url}"><div class="wa-frame-label">${posNames[waPos]}</div></div>`;

  // Haptic feedback
  if (navigator.vibrate) navigator.vibrate(50);
  toast(posNames[waPos]+' ✓','success',1000);

  // Auto advance to next position
  const nextUndone = posDone.indexOf(false);
  if (nextUndone >= 0) setPos(nextUndone);
  else {
    document.querySelectorAll('.wa-pos-btn').forEach((b,j) => b.classList.toggle('done', posDone[j]));
    updateCaptureProgress();
    toast('Alle 8 hoeken vastgelegd! 360° compleet','success',2000);
  }
  updateCaptureProgress();

  // Store for 360 spinner in result view
  window._t4c360 = waFrames.filter(f=>f.url).sort((a,b)=>a.pos-b.pos);
}

function showDamageMap() {
  if (waStream) { waStream.getTracks().forEach(t => t.stop()); waStream = null; }
  document.getElementById('wa-camera').style.display = 'none';
  document.getElementById('wa-map').style.display = 'block';
}

function openDmg(zone, x, y) {
  currentDmgZone = zone;
  currentDmgX = x;
  currentDmgY = y;
  document.getElementById('wa-modal-zone').textContent = zone.charAt(0).toUpperCase() + zone.slice(1);
  document.getElementById('wa-modal').style.display = 'flex';
  document.getElementById('wa-cost').value = '';
  document.querySelectorAll('.wa-dt').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.wa-sev').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.wa-sev')[1].classList.add('active');
  updateCostSuggest();
}

function closeModal() {
  document.getElementById('wa-modal').style.display = 'none';
}

function selType(btn) {
  document.querySelectorAll('.wa-dt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateCostSuggest();
}
function selSev(btn) {
  document.querySelectorAll('.wa-sev').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateCostSuggest();
}

function updateCostSuggest() {
  const type = document.querySelector('.wa-dt.active')?.dataset.t;
  const sev = document.querySelector('.wa-sev.active')?.dataset.s || 'gemiddeld';
  const el = document.getElementById('wa-cost-suggest');
  if (!type || !COSTS[type]) { el.innerHTML = ''; return; }
  const [lo, hi] = COSTS[type][sev];
  const mid = Math.round((lo + hi) / 2);
  el.innerHTML = `<button class="wa-cost-sug" onclick="document.getElementById('wa-cost').value=${lo}">€${lo}</button>
    <button class="wa-cost-sug" onclick="document.getElementById('wa-cost').value=${mid}">€${mid}</button>
    <button class="wa-cost-sug" onclick="document.getElementById('wa-cost').value=${hi}">€${hi}</button>`;
  if (!document.getElementById('wa-cost').value) document.getElementById('wa-cost').value = mid;
}

function addDamage() {
  const type = document.querySelector('.wa-dt.active')?.dataset.t;
  const sev = document.querySelector('.wa-sev.active')?.dataset.s || 'gemiddeld';
  const cost = Number(document.getElementById('wa-cost').value) || 0;
  if (!type) return toast('Selecteer eerst het type schade','warning');

  const dmg = {
    id: Date.now(),
    zone: currentDmgZone, type, sev, cost,
    x: currentDmgX, y: currentDmgY
  };
  damages.push(dmg);

  // Add marker to SVG
  const markers = document.getElementById('damageMarkers');
  const color = sev === 'licht' ? '#00FF9C' : sev === 'gemiddeld' ? '#ffc107' : '#ef4444';
  const ns = 'http://www.w3.org/2000/svg';
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', dmg.x);
  circle.setAttribute('cy', dmg.y);
  circle.setAttribute('r', '10');
  circle.setAttribute('fill', color);
  circle.setAttribute('opacity', '0.8');
  circle.setAttribute('class', 'dmg-pulse');
  markers.appendChild(circle);

  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', dmg.x);
  text.setAttribute('y', dmg.y + 4);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('fill', 'white');
  text.setAttribute('font-size', '10');
  text.setAttribute('font-weight', '700');
  text.textContent = damages.length;
  markers.appendChild(text);

  closeModal();
  renderDamageList();
  if (navigator.vibrate) navigator.vibrate(30);
}

function removeDamage(id) {
  damages = damages.filter(d => d.id !== id);
  // Re-render markers
  document.getElementById('damageMarkers').innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  damages.forEach((d, i) => {
    const color = d.sev === 'licht' ? '#00FF9C' : d.sev === 'gemiddeld' ? '#ffc107' : '#ef4444';
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', d.x); c.setAttribute('cy', d.y); c.setAttribute('r', '10');
    c.setAttribute('fill', color); c.setAttribute('opacity', '0.8'); c.setAttribute('class', 'dmg-pulse');
    document.getElementById('damageMarkers').appendChild(c);
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', d.x); t.setAttribute('y', d.y + 4); t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', 'white'); t.setAttribute('font-size', '10'); t.setAttribute('font-weight', '700');
    t.textContent = i + 1;
    document.getElementById('damageMarkers').appendChild(t);
  });
  renderDamageList();
}

function renderDamageList() {
  const el = document.getElementById('wa-damage-list');
  const totals = document.getElementById('wa-totals');
  if (!damages.length) { el.innerHTML = ''; totals.style.display = 'none'; return; }

  el.innerHTML = damages.map((d, i) => {
    const sevColor = d.sev === 'licht' ? 'var(--green)' : d.sev === 'gemiddeld' ? 'var(--yellow)' : 'var(--red)';
    return `<div class="wa-dmg-item">
      <div class="wa-dmg-sev" style="background:${sevColor}"></div>
      <div class="wa-dmg-info"><div class="wa-dmg-zone">${d.zone}</div><div class="wa-dmg-type">${d.type} (${d.sev})</div></div>
      <div class="wa-dmg-cost">€${d.cost}</div>
      <button class="wa-dmg-del" onclick="removeDamage(${d.id})">✕</button>
    </div>`;
  }).join('');

  const totalCost = damages.reduce((s, d) => s + d.cost, 0);
  const priceImpact = Math.round(totalCost * 1.15); // 15% extra marge voor onderhandeling
  document.getElementById('wa-total-cost').textContent = '€' + totalCost.toLocaleString('nl-NL');
  document.getElementById('wa-price-impact').textContent = '-€' + priceImpact.toLocaleString('nl-NL');
  totals.style.display = 'block';
}

async function finishInspection() {
  const plate = document.getElementById('wa-plate').value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const totalCost = damages.reduce((s, d) => s + d.cost, 0);

  // Save to backend
  try {
    const res = await fetch('/api/inspectie', {
      method: 'POST', headers: _authH(),
      body: JSON.stringify({
        kenteken: fmtP(plate),
        inspecteur: 'App',
        exterieur_score: calcScore('exterieur'),
        interieur_score: calcScore('interieur'),
        technisch_score: calcScore('technisch'),
        totaal_kosten: totalCost,
        opmerkingen: damages.map(d => `${d.zone}: ${d.type} (${d.sev}) €${d.cost}`).join('; '),
        status: 'afgerond'
      })
    });
    const d = await res.json();
    if (d.ok) {
      // Add individual gebreken
      for (const dmg of damages) {
        await fetch(`/api/inspectie/${d.id}/gebrek`, {
          method: 'POST', headers: _authH(),
          body: JSON.stringify({ categorie: dmg.zone, omschrijving: `${dmg.type} (${dmg.sev})`, ernst: dmg.sev, geschatte_kosten: dmg.cost })
        });
      }
      // Chain into taxatie with damage correction
      stopInspCam();
      pendingDamageCost = totalCost;
      pendingDamageCount = damages.length;
      const plateVal = fmtP(plate);
      document.getElementById('mp').value = plateVal;
      document.getElementById('mk').value = '';
      go('loading');
      try {
        ldStep(1);
        const vR = await fetch('/api/vehicle/enriched?plate=' + plate);
        const v = await vR.json();
        if (!v || !v.make) throw new Error('Voertuig niet gevonden');
        ldStep(2);
        let m = null;
        try {
          const mR = await fetch('/api/market?make=' + encodeURIComponent(v.make) + '&model=' + encodeURIComponent(v.model) + '&year=' + v.year + '&km=0&sub=' + encodeURIComponent(v.subModel||'') + '&body=' + encodeURIComponent(v.body||'') + '&fuel=' + encodeURIComponent(v.fuel||'') + '&transmission=' + encodeURIComponent(v.transmissionAuto?'automaat':v.transmissionType?'handgeschakeld':''));
          m = await mR.json();
        } catch(e) {}
        ldStep(3);
        const pR = await fetch('/api/dealer/price', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            make: v.make, model: v.model, year: v.year, km: Number(v.km)||0, fuel: v.fuel,
            weightKg: v.weightKg, catalogPrice: v.catalogPrice, bpm: v.bpm, power: v.powerKw,
            marketAvg: m?m.avg:null, marketMedian: m?m.median:null, marketCount: m?m.count:null,
            marketPrices: m?m.prices:null, marketP10: m?m.p10:null, marketP25: m?m.p25:null,
            marketP75: m?m.p75:null, marketP90: m?m.p90:null,
            marketQuality: m&&m.validation?m.validation.quality:null,
            finnikAvailable: v.source&&v.source.finnik===true,
            importFlag: v.importFlag, stolenFlag: v.stolenFlag,
            transmissionAuto: v.transmissionAuto, equipmentLevel: v.equipmentLevel,
            engineLabel: v.engineLabel, subModel: v.subModel, damageCost: totalCost
          })
        });
        const r = await pR.json();
        last = { v, m, r, plate: plateVal, km: Number(v.km)||0, damageCost: totalCost, damageCount: damages.length };
        go('result'); render();
      } catch(e) { toast('Taxatie mislukt: '+e.message,'error'); go('home'); }
    }
  } catch (e) { toast('Opslaan mislukt: '+e.message,'error'); }
}

function calcScore(cat) {
  // Calculate score based on number and severity of damages in this category
  const relevant = damages.filter(d => {
    if (cat === 'exterieur') return ['kras','deuk','lakschade','roest','bumper','velg','spiegel'].includes(d.type);
    if (cat === 'interieur') return d.zone.includes('interieur');
    if (cat === 'technisch') return d.zone.includes('motor');
    return false;
  });
  if (!relevant.length) return 5;
  const sevWeight = { licht: 0.5, gemiddeld: 1, ernstig: 2 };
  const totalSev = relevant.reduce((s, d) => s + (sevWeight[d.sev] || 1), 0);
  return Math.max(1, Math.round(5 - totalSev));
}

// Init on page load
document.addEventListener('DOMContentLoaded', () => {
  if (_t4cToken()) {
    document.querySelector('.bnav').style.display='flex';
    // Handle PWA shortcuts
    const hash = location.hash.replace('#','');
    if (hash && document.getElementById('s-'+hash)) {
      go(hash);
    } else {
      go('home');
    }
  } else {
    document.getElementById('s-login').classList.add('active');
    document.querySelector('.bnav').style.display='none';
  }
});
