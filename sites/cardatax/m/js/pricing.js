/* ═══════════════════════════════════════
   CarDatax Mobile — Pricing & Sliders
   ═══════════════════════════════════════ */
// ═══ PRICING FORMULA — Client's deterministic model ═══
// IP = VP - (VP × margePercent) - (RK_base + RK_extra) - RC - OR - (VP × seizoenPercent) + (VP × courantBonusPercent) + btwBonusEuro

function detectSegment(v){
  const mk=(v.make||'').toLowerCase(),ml=(v.model||'').toLowerCase(),fl=(v.fuel||'').toLowerCase(),sub=(v.subModel||'').toLowerCase(),body=(v.body||'').toLowerCase();
  // LCV check first
  if(['transporter','caddy','crafter','sprinter','transit','vivaro','trafic','expert','jumpy','boxer','ducato','daily','master','movano','berlingo','partner','kangoo','combo','nv200','proace','hiace','vito','citan','courier'].some(s=>ml.includes(s)))return 'lcv';
  if(body.includes('bedrijfs')||body.includes('bestel'))return 'lcv';
  if(fl.includes('elektr')||fl.includes('electric'))return 'ev';
  if(['porsche','jaguar','land rover','maserati','bentley','ferrari','lamborghini','aston martin'].some(s=>mk.includes(s)))return 'sport';
  if(['bmw','audi','mercedes','lexus','volvo','infiniti','alfa romeo','mini','ds'].some(s=>mk.includes(s)))return 'premium';
  if(['gti','rs','amg','cupra','nismo','type r'].some(s=>sub.includes(s)))return 'sport';
  if(['dacia','suzuki','mg','lada','ssangyong'].some(s=>mk.includes(s)))return 'budget';
  return 'midden';
}

function staffelMarge(vp,seg){
  // Segment override
  const segMarges={budget:0.12,midden:0.10,premium:0.08,ev:0.09,lcv:0.09,sport:0.14};
  if(seg&&segMarges[seg]!==undefined)return segMarges[seg];
  // Staffel fallback
  if(vp<7500)return 0.13;
  if(vp<12500)return 0.12;
  if(vp<20000)return 0.10;
  if(vp<35000)return 0.09;
  return 0.08;
}

function courantBonusPct(s){
  const tbl=[0,0,0,0.5,1,1.5,2,2.5,3,3.5,4];
  return tbl[Math.min(10,Math.max(0,s))]||0;
}

function risicoCorrectie(s){
  const tbl=[0,0,150,250,350,500,650,850,1100,1400,1800];
  return tbl[Math.min(10,Math.max(0,s))]||0;
}

function staatKosten(s){
  const tbl=[0,1200,900,700,550,400,300,200,100,0,0];
  return tbl[Math.min(10,Math.max(0,s))]||0;
}

function seizoenPct(s){
  const tbl={neutraal:0,cabrio_winter:-0.03,cabrio_zomer:0.03,suv_winter:0.02,diesel_stad:-0.02,schaars:0.02,overstock:-0.02};
  return tbl[s]||0;
}

const maintCosts={distributie:750,banden:300,remmen:250,beurt:400,ruit:200,velgen:150,interieur:250};

function recalcBod(){
  const c=window._t4cCalc;if(!c)return{bod:0,marge:0,margePct:0,margePctUsed:0,rkTotal:0,risicoCor:0,onderhoud:0,courantBonus:0};
  const vp=c.vp;
  const seg=c.segment||(document.getElementById('sl-segment')?document.getElementById('sl-segment').value:'midden');

  // Marge: override of staffel
  let margePct=c.overrides.marge!==null&&c.overrides.marge>0?c.overrides.marge/100:staffelMarge(vp,seg);

  // Export marge: +3% (export = hogere marge nodig voor transport/risico)
  if(c.verkoopType==='export')margePct+=0.03;

  // LCV body/cabin correctie
  if(seg==='lcv'&&c.isLCV){
    const ml=(c.v.model||'').toLowerCase(),body=(c.v.body||'').toLowerCase();
    const isPopular=['l2h2','dubbele cabine','double cab','doka','l2','lang'].some(k=>ml.includes(k)||body.includes(k));
    const isNiche=['chassis','kipper','koffer','bakwagen','koelwagen','gesloten'].some(k=>ml.includes(k)||body.includes(k));
    if(isPopular)margePct=Math.max(0.01,margePct-0.005); // -0.5% voor populaire L2H2/dubbele cabine
    if(isNiche)margePct+=0.015; // +1.5% voor niche opbouw
  }

  // RK basis: override of default €250
  const rkBase=c.overrides.rkBasis!==null&&c.overrides.rkBasis>=0?c.overrides.rkBasis:250;
  const rkExtra=staatKosten(c.staat);
  const rc=risicoCorrectie(c.risico);

  // Onderhoud toggles
  let or=0;
  Object.keys(c.toggles).forEach(k=>{if(c.toggles[k])or+=maintCosts[k]||0});

  // Seizoen: override of dropdown
  let seizPct;
  if(c.overrides.seizoenPct!==null&&c.overrides.seizoenPct!==undefined&&c.overrides.seizoenPct!==0){
    seizPct=c.overrides.seizoenPct/100;
  } else {
    seizPct=seizoenPct(c.seizoen||(document.getElementById('sl-seizoen')?document.getElementById('sl-seizoen').value:'neutraal'));
  }

  const courantPct=courantBonusPct(c.courant)/100;

  // BTW bonus: override of auto
  let btwBonus;
  if(c.overrides.btwBonus!==null&&c.overrides.btwBonus>=0){
    btwBonus=c.overrides.btwBonus;
  } else {
    btwBonus=c.btwAuto?Math.round(vp*0.02):0;
    // LCV BTW auto's krijgen standaard 2% bonus (3% voor populaire L2H2)
    if(seg==='lcv'&&c.btwAuto){
      const ml=(c.v.model||'').toLowerCase();
      const isPopularLCV=['l2h2','l2','lang','dubbele cabine'].some(k=>ml.includes(k));
      btwBonus=Math.round(vp*(isPopularLCV?0.03:0.02));
    }
  }

  // BPM correctie
  const bpmCor=c.overrides.bpmCorrectie||0;

  // ═══ FORMULE: IP = VP - (VP × marge%) - (RK_base + RK_extra) - RC - OR - (VP × seizoen%) + (VP × courant%) + BTW_bonus - BPM_correctie ═══
  let bod=vp-(vp*margePct)-(rkBase+rkExtra)-rc-or-(vp*Math.abs(seizPct))*(seizPct<0?1:-1)+(vp*courantPct)+btwBonus-bpmCor;

  // Seizoen correct toepassen: negatief = aftrekken, positief = optellen
  bod=vp-(vp*margePct)-(rkBase+rkExtra)-rc-or+(vp*seizPct)+(vp*courantPct)+btwBonus-bpmCor;

  bod=Math.round(Math.max(bod,500)); // Floor

  const marge=vp-bod;
  const margePctCalc=vp>0?Math.round(marge/vp*100):0;

  return{bod,marge,margePct:margePctCalc,margePctUsed:Math.round(margePct*100),rkTotal:rkBase+rkExtra,risicoCor:rc,onderhoud:or,courantBonus:Math.round(vp*courantPct),btwBonus,bpmCor};
}

function onSlider(){
  const c=window._t4cCalc;if(!c)return;
  c.courant=parseInt(document.getElementById('sl-courant').value);
  c.risico=parseInt(document.getElementById('sl-risico').value);
  c.staat=parseInt(document.getElementById('sl-staat').value);
  c.segment=document.getElementById('sl-segment').value;
  c.seizoen=document.getElementById('sl-seizoen').value;

  // Update display labels
  document.getElementById('sl-courant-val').textContent=c.courant+'/10 → +'+courantBonusPct(c.courant)+'%';
  document.getElementById('sl-risico-val').textContent=c.risico+'/10 → -'+E(risicoCorrectie(c.risico));
  document.getElementById('sl-staat-val').textContent=c.staat+'/10 → -'+E(staatKosten(c.staat));

  updateLiveBod();
}

function toggleMaint(el,key){
  const c=window._t4cCalc;if(!c)return;
  c.toggles[key]=!c.toggles[key];
  el.classList.toggle('active',c.toggles[key]);
  updateLiveBod();
}

function setBtw(isBtw){
  const c=window._t4cCalc;if(!c)return;
  c.btwAuto=isBtw;
  document.getElementById('btw-marge').classList.toggle('active',!isBtw);
  document.getElementById('btw-btw').classList.toggle('active',isBtw);
  updateLiveBod();
}

function onOverride(){
  const c=window._t4cCalc;if(!c)return;
  const mV=document.getElementById('ov-marge')?.value;
  const rkV=document.getElementById('ov-rk')?.value;
  const szV=document.getElementById('ov-seizoen')?.value;
  const btwV=document.getElementById('ov-btw')?.value;
  const bpmV=document.getElementById('ov-bpm')?.value;
  c.overrides.marge=mV&&mV!==''?parseFloat(mV):null;
  c.overrides.rkBasis=rkV&&rkV!==''?parseFloat(rkV):null;
  c.overrides.seizoenPct=szV&&szV!==''?parseFloat(szV):null;
  c.overrides.btwBonus=btwV&&btwV!==''?parseFloat(btwV):null;
  c.overrides.bpmCorrectie=bpmV&&bpmV!==''?parseFloat(bpmV):0;
  updateLiveBod();
}

function onBidSlider(){
  const sl=document.getElementById('bid-slider');
  const val=parseInt(sl.value);
  const c=window._t4cCalc;if(!c)return;
  const vp=c.vp;
  const marge=vp-val;
  const margePct=vp>0?Math.round(marge/vp*100):0;
  document.getElementById('bid-slider-val').textContent=E(val);
  document.getElementById('bid-slider-marge').textContent=E(marge);
  document.getElementById('bid-slider-margepct').textContent=margePct;
  // Also update main display
  const bodEl=document.getElementById('live-bod');
  const bod2El=document.getElementById('live-bod2');
  if(bodEl)bodEl.textContent=E(val);
  if(bod2El)bod2El.textContent=E(val);
  document.getElementById('bid-slider-marge').style.color=marge>2000?'var(--green)':marge>0?'var(--orange)':'var(--red)';
}

function updateLiveBod(){
  const calc=recalcBod();
  const bodEl=document.getElementById('live-bod');
  const bod2El=document.getElementById('live-bod2');
  const margeEl=document.getElementById('live-marge');
  const margePctEl=document.getElementById('live-margepct');
  const ondEl=document.getElementById('live-onderhoud');
  const breakEl=document.getElementById('live-breakdown');

  if(bodEl){bodEl.textContent=E(calc.bod);bodEl.classList.add('recalc-flash');setTimeout(()=>bodEl.classList.remove('recalc-flash'),400)}
  if(bod2El){bod2El.textContent=E(calc.bod);bod2El.classList.add('recalc-flash');setTimeout(()=>bod2El.classList.remove('recalc-flash'),400)}
  if(margeEl){margeEl.textContent=E(calc.marge);margeEl.style.color=calc.marge>2000?'var(--green)':calc.marge>0?'var(--orange)':'var(--red)'}
  if(margePctEl)margePctEl.textContent=calc.margePct+'%';
  if(ondEl)ondEl.textContent='€ '+calc.onderhoud.toLocaleString('nl-NL');

  // Breakdown text
  let bk='VP '+E(window._t4cCalc.vp)+' - marge '+calc.margePctUsed+'% - RK €'+calc.rkTotal+' - risico €'+calc.risicoCor+' - onderhoud €'+calc.onderhoud;
  if(calc.courantBonus>0)bk+=' + bonus €'+calc.courantBonus;
  if(calc.btwBonus>0)bk+=' + BTW €'+calc.btwBonus;
  if(calc.bpmCor>0)bk+=' - BPM €'+calc.bpmCor;
  if(breakEl)breakEl.textContent=bk;

  // Sync bid slider
  const bidSl=document.getElementById('bid-slider');
  if(bidSl){
    bidSl.value=calc.bod;
    bidSl.min=Math.round(calc.bod*0.7);
    bidSl.max=Math.round(window._t4cCalc.vp*0.95);
    document.getElementById('bid-slider-val').textContent=E(calc.bod);
    document.getElementById('bid-slider-marge').textContent=E(calc.marge);
    document.getElementById('bid-slider-margepct').textContent=calc.margePct;
    document.getElementById('bid-slider-marge').style.color=calc.marge>2000?'var(--green)':calc.marge>0?'var(--orange)':'var(--red)';
  }
}

function copyBod(){
  const c=window._t4cCalc;if(!c)return;
  const bod=document.getElementById('live-bod2')?.textContent||'';
  const txt=c.v.make+' '+c.v.model+' '+c.v.year+'\nKenteken: '+c.plate+'\nBod: '+bod+'\nRetail: '+E(c.vp)+'\nMarge: '+E(c.vp-recalcBod().bod);
  navigator.clipboard?.writeText(txt).then(()=>toast('Bod gekopieerd','success')).catch(()=>{
    const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('Bod gekopieerd','success');
  });
}

function updateProfiel(){
  const user=localStorage.getItem('t4c_user');
  if(user){
    try{
      const u=JSON.parse(user);
      const nameEl=document.getElementById('prof-name');
      const roleEl=document.getElementById('prof-role');
      const avatarEl=document.getElementById('prof-avatar');
      if(nameEl)nameEl.textContent=u.name||u.username||'Gebruiker';
      if(roleEl)roleEl.textContent=u.role==='admin'?'Administrator':'Dealer';
      if(avatarEl)avatarEl.textContent=(u.name||u.username||'?')[0].toUpperCase();
    }catch{}
  }
  document.getElementById('prof-today').textContent=recent.filter(r=>r.ts&&(Date.now()-r.ts)<86400000).length;
  document.getElementById('prof-total').textContent=recent.length;
}

// ═══ EXPORT vs NL toggle ═══
function setVerkoopType(type){
  const c=window._t4cCalc;if(!c)return;
  c.verkoopType=type;
  document.getElementById('vt-nl').classList.toggle('active',type==='nl');
  document.getElementById('vt-export').classList.toggle('active',type==='export');
  // Export = +3% marge (harder to sell locally)
  // NL = default staffel
  updateLiveBod();
}


function showVoorraadModal(){
  const m=document.getElementById('voorraad-modal');
  m.style.display='block';
  const input=document.getElementById('voorraad-prijs');
  input.value=last?.r?.verkoopadviees||last?.r?.internetPrijs||'';
  input.focus();
}

async function doAddVoorraad(){
  if(!last)return;
  const{v,r,plate,km}=last;
  const prijs=document.getElementById('voorraad-prijs').value;
  if(!prijs)return toast('Voer een vraagprijs in','warning');
  try{
    const res=await fetch('/api/voorraad/add',{method:'POST',headers:_authH(),body:JSON.stringify({kenteken:plate,make:v.make,model:v.model,model_variant:v.modelVariant||v.subModel||'',year:v.year,fuel:v.fuel,km:km||0,color:v.color,body:v.body,power_kw:v.powerKw,power_hp:v.powerHp,engine_label:v.engineLabel,transmission:v.transmissionType||'',vraag_prijs:Number(prijs),beschrijving:'',highlights:'',apk_until:v.apkUntil||'',vin:v.vin||'',status:'te_koop',featured:false})});
    const d=await res.json();
    if(d.ok){toast('Toegevoegd aan voorraad','success');document.getElementById('voorraad-modal').style.display='none'}
    else toast(d.error||'Server fout','error');
  }catch{toast('Er ging iets mis','error')}
}

async function exportPdf(){
  if(!last)return;
  toast('PDF genereren...','info',2000);
  const calc=recalcBod();
  const c=window._t4cCalc||{};
  try{
    const r=await fetch('/api/pdf',{method:'POST',headers:_authH(),body:JSON.stringify({
      kenteken:last.plate,make:last.v.make,model:last.v.model,year:last.v.year,km:last.km,
      fuel:last.v.fuel,power:last.v.powerHp,transmission:last.v.transmissionType||'',
      // Prijzen (live berekend)
      bod:calc.bod,
      atr:last.r.verkoopadviees||last.r.internetPrijs,
      etr:last.r.handelswaarde,
      inkoopLow:last.r.inkoopLow,inkoopHigh:last.r.inkoopHigh,
      marge:calc.marge,margePct:calc.margePct,
      // Scores
      courantScore:c.courant||0,vergelijkScore:last.r.itr||last.r.confidence||0,
      techniekScore:last.v.engineRiskProfile||'Onbekend',margeScore:calc.margePctUsed,
      // Sliders
      risico:c.risico||0,staat:c.staat||0,segment:c.segment||'midden',
      // Onderhoud
      onderhoud:calc.onderhoud,toggles:c.toggles||{},
      // Formule breakdown
      breakdown:'VP '+E(c.vp)+' - marge '+calc.margePctUsed+'% - RK €'+calc.rkTotal+' - risico €'+calc.risicoCor+' - onderhoud €'+calc.onderhoud+(calc.courantBonus>0?' + bonus €'+calc.courantBonus:'')+(calc.btwBonus>0?' + BTW €'+calc.btwBonus:'')+(calc.bpmCor>0?' - BPM €'+calc.bpmCor:''),
      // Extra
      verkoopType:c.verkoopType||'nl',
      smartSummary:last.r.smartSummary||[],
      confidence:last.r.confidence||0
    })});
    if(!r.ok) throw new Error('PDF fout');
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='taxatie-'+last.plate+'.pdf';a.click();
    URL.revokeObjectURL(url);
    toast('PDF gedownload','success');
  }catch(e){toast('PDF mislukt: '+e.message,'error')}
}

let fotoFiles = [];
