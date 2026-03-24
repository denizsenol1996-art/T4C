// CarDatax Taxatie — doTax, render, pricing formula, sliders

// CarDatax Taxatie — doTax, render, pricing formula, sliders
// Auto-generated from app refactor

async function doTax(){
  const errEl=document.getElementById('tax-error');
  if(errEl){errEl.style.display='none';errEl.textContent=''}
  const p=document.getElementById('mp').value.replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
  const km=document.getElementById('mk').value.replace(/[^0-9]/g,'');
  if(!p||p.length<5){
    if(errEl){errEl.textContent='Voer een geldig kenteken in (minimaal 5 tekens)';errEl.style.display='block'}
    else toast('Voer een geldig kenteken in','warning');
    return;
  }
  go('loading');
  ldStep(1);
  try {
    // STAP 1: Voertuigdata ophalen (moet eerst — we hebben make/model nodig)
    const vR=await fetch(`/api/vehicle/enriched?plate=${p}${km?'&km='+km:''}`);
    if(!vR.ok) throw new Error('Server fout ('+vR.status+')');
    const v=await vR.json();
    if(v.error) throw new Error(v.error);
    if(!v?.make) throw new Error('Kenteken niet gevonden bij RDW');

    ldStep(2);
    // STAP 2+3: Marktdata + Prijsberekening PARALLEL (ipv sequentieel)
    ldStep(2);
    const [mR, pR] = await Promise.allSettled([
      fetch(`/api/market?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}&year=${v.year}&km=${km||0}&sub=${encodeURIComponent(v.subModel||'')}&body=${encodeURIComponent(v.body||'')}&fuel=${encodeURIComponent(v.fuel||'')}&transmission=${encodeURIComponent(v.transmissionAuto?'automaat':'')}`).then(r=>r.json()),
      fetch('/api/dealer/price',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plate:fmtP(p),make:v.make,model:v.model,year:v.year,km:Number(km)||v.km||0,fuel:v.fuel,weightKg:v.weightKg,catalogPrice:v.catalogPrice,bpm:v.bpm,power:v.powerKw,ownerCount:v.ownerCount||0,isExDealer:v.isExDealer||false,bpmRest:v.bpmRest||0,bijtelling:v.bijtelling||null,emissieKlasse:v.emissieKlasse||null,importFlag:v.importFlag,stolenFlag:v.stolenFlag,transmissionAuto:v.transmissionAuto,transmissionType:v.transmissionType,transmissionDetail:v.transmissionDetail,engineLabel:v.engineLabel,subModel:v.subModel,vin:v.vin,motorCode:v.motorCode,generation:v.generation,trimLevel:v.trimLevel,drivetrain:v.drivetrain,engineRiskProfile:v.engineRiskProfile,courantScore:v.courantScore,optionPriceImpact:v.optionPriceImpact})}).then(r=>r.json())
    ]);
    const m=mR.status==='fulfilled'?mR.value:null;
    const r=pR.status==='fulfilled'?pR.value:null;
    if(!r||r.error) throw new Error(r?.error||'Prijsberekening mislukt');
    ldStep(4);
    last={v,m,r,plate:fmtP(p),km:Number(km)||0,damageCost:0,damageCount:0,intel:null};
    recent=recent.filter(x=>x.plate!==last.plate);
    recent.unshift({plate:fmtP(p),make:v.make,model:v.model,year:v.year,bod:r.handelswaarde||r.t4cBod||((r.inkoopLow&&r.inkoopHigh)?Math.round((r.inkoopLow+r.inkoopHigh)/2):0),ts:Date.now()});
    if(recent.length>20)recent=recent.slice(0,20);
    try{localStorage.setItem('t4c_rec',JSON.stringify(recent))}catch{}

    // Auto-save (fire-and-forget — niet wachten)
    fetch('/api/taxatie/save',{method:'POST',headers:_authH(),body:JSON.stringify({kenteken:last.plate,make:v.make,model:v.model,year:v.year,fuel:v.fuel,km:last.km,power_kw:v.powerKw,power_hp:v.powerHp,engine_label:v.engineLabel,verkoopadviees:r.verkoopadviees,handelswaarde:r.handelswaarde,inkoop_low:r.inkoopLow,inkoop_high:r.inkoopHigh,internet_prijs:r.internetPrijs,market_count:m?.count,p25:m?.p25,p50:m?.median,p75:m?.p75,status:'concept'})}).catch(()=>{});

    render(); go('result');
    fetch(`/api/intelligence/${encodeURIComponent(v.make)}/${encodeURIComponent(v.model)}/${v.year}`,{headers:_authH()}).then(r=>r.json()).then(d=>{if(d.ok){last.intel=d;renderIntel()}}).catch(()=>{});
    // ═══ CONFIDENCE BADGE (fire-and-forget) ═══
    fetchConfidence(v, r);
    fetchAccuracy(v);
    // ═══ CARDATAX AI VALIDATOR (fire-and-forget) ═══
    var calc = (typeof recalcBod === "function") ? recalcBod() : {bod:r.inkoopLow||0,bodRaw:r.inkoopLow||0};
    fetchGptValidator(v, m, r, calc);

    // ═══ AUTO-GENERATE CAR IMAGES (fire-and-forget, background) ═══
    generateCarImages(last);
  }catch(e){
    console.error('doTax error:', e);
    go('taxatie');
    if(errEl){errEl.textContent=e.message;errEl.style.display='block'}
    else toast(e.message,'error');
  }
}

// ═══ SESSIE 3: CONFIDENCE BADGE (fire-and-forget) ═══
async function fetchConfidence(v, r){
  try {
    const resp = await fetch(`/api/taxatie/confidence/${encodeURIComponent(v.make)}/${encodeURIComponent(v.model)}/${v.year}`, {headers: _authH()});
    const d = await resp.json();
    if(!d.ok) return;

    return; // DISABLED
    const el = document.getElementById('confidence-badge');
    if(!el) return;

    const pct = d.confidence_pct || 0;
    const col = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
    const bgCol = pct >= 80 ? 'rgba(0,255,156,.06)' : pct >= 50 ? 'rgba(255,183,77,.06)' : 'rgba(255,77,77,.06)';
    const borderCol = pct >= 80 ? 'rgba(0,255,156,.2)' : pct >= 50 ? 'rgba(255,183,77,.2)' : 'rgba(255,77,77,.2)';
    const label = d.label || (pct >= 80 ? 'Zeer betrouwbaar' : pct >= 50 ? 'Redelijk betrouwbaar' : 'Beperkte data');

    // Systems (triple validation)
    let sysHtml = '';
    if(d.systems && d.systems.length){
      sysHtml = d.systems.map(s => {
        const sc = s.status === 'actief' ? 'var(--green)' : s.status === 'beperkt' ? 'var(--orange)' : 'var(--text4)';
        const icon = s.status === 'actief' ? '✅' : s.status === 'beperkt' ? '🟡' : '⚫';
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-l)">
          <span style="font-size:14px">${icon}</span>
          <span style="font-size:12px;color:var(--text2);flex:1">${s.name}</span>
          <span style="font-size:10px;font-weight:700;color:${sc};text-transform:uppercase;letter-spacing:.5px">${s.status}</span>
        </div>`;
      }).join('');
    }

    // Sold references + actual sold prices
    let soldHtml = '';
    if(d.sold_references > 0 || d.sold_count > 0){
      const sc = d.sold_count || d.sold_references || 0;
      const hasPrices = d.sold_median > 0;
      // Vraag vs verkoopprijs verschil
      const askMedian = r?.internetPrijs || r?.verkoopadviees || 0;
      const diffPct = (hasPrices && askMedian > 0) ? Math.round((1 - d.sold_median / askMedian) * 100) : 0;
      const diffHtml = (diffPct > 0) ? `<div style="margin-top:8px;padding:6px 10px;background:rgba(0,0,0,.2);border-radius:6px;font-size:11px;color:var(--text2)">Vergelijkbare auto's worden gemiddeld <strong style="color:var(--green)">${diffPct}% onder vraagprijs</strong> verkocht</div>` : '';
      soldHtml = `<div style="margin-top:10px;padding:10px 14px;background:rgba(0,255,156,.05);border:1px solid rgba(0,255,156,.15);border-radius:8px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:${hasPrices?'8':'0'}px">
          <span style="font-size:14px">📊</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--green)">Vergelijkbare auto's verkocht</div>
            <div style="font-size:10px;color:var(--text3)">${sc} referenties • werkelijke transactieprijzen</div>
          </div>
        </div>
        ${hasPrices ? `<div style="display:flex;gap:8px;margin-top:4px">
          <div style="flex:1;text-align:center;padding:6px;background:rgba(0,0,0,.15);border-radius:6px">
            <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:.5px">Laagste</div>
            <div style="font-size:14px;font-weight:700;font-family:var(--mono);color:var(--text1)">${E(d.sold_low)}</div>
          </div>
          <div style="flex:1;text-align:center;padding:6px;background:rgba(0,255,156,.08);border:1px solid rgba(0,255,156,.15);border-radius:6px">
            <div style="font-size:9px;color:var(--green);text-transform:uppercase;letter-spacing:.5px;font-weight:700">Mediaan</div>
            <div style="font-size:16px;font-weight:800;font-family:var(--mono);color:var(--green)">${E(d.sold_median)}</div>
          </div>
          <div style="flex:1;text-align:center;padding:6px;background:rgba(0,0,0,.15);border-radius:6px">
            <div style="font-size:9px;color:var(--text4);text-transform:uppercase;letter-spacing:.5px">Hoogste</div>
            <div style="font-size:14px;font-weight:700;font-family:var(--mono);color:var(--text1)">${E(d.sold_high)}</div>
          </div>
        </div>` : ''}
        ${diffHtml}
      </div>`;
    }

    el.innerHTML = `
      <div style="background:${bgCol};border:1px solid ${borderCol};border-radius:var(--radius);padding:14px 16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:12px;font-weight:700;color:var(--text1);text-transform:uppercase;letter-spacing:.5px">Betrouwbaarheid</div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:22px;font-weight:800;font-family:var(--mono);color:${col}">${pct}%</span>
          </div>
        </div>
        <div style="font-size:12px;color:${col};font-weight:600;margin-bottom:4px">${label}</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:10px">${d.data_points||0} datapunten • ${d.active_listings||0} actieve listings • ${d.sold_references||0} verkocht</div>

        <!-- Triple Validation -->
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">XXX ${(d.systems||[]).filter(s=>s.status==='actief').length} systemen</div>
        ${sysHtml}
        ${soldHtml}
      </div>`;
  } catch(e){
    console.warn('[Confidence]', e);
  }
}

// ═══ SESSIE 3: GPT VALIDATOR (fire-and-forget) ═══
async function fetchAccuracy(v){
  try {
    const resp = await fetch(`/api/intelligence/accuracy/${encodeURIComponent(v.make)}/${encodeURIComponent(v.model)}/${v.year}`, {headers: _authH()});
    const d = await resp.json();
    const el = document.getElementById('accuracy-badge');
    if(!el) return;
    if(!d.ok || !d.accuracy || d.accuracy.sample_size < 1){ el.innerHTML = ''; return; }
    const a = d.accuracy;
    const pct = Math.round((a.accuracy_pct || 0) * 10) / 10;
    const col = pct >= 95 ? 'var(--green)' : pct >= 85 ? 'var(--orange)' : 'var(--red)';
    el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,255,156,.04);border:1px solid rgba(0,255,156,.12);border-radius:8px;margin-bottom:12px">
      <div style="font-size:20px;font-weight:900;font-family:var(--mono);color:${col}">${pct}%</div>
      <div><div style="font-size:12px;font-weight:700;color:var(--text1)">CarDatax nauwkeurigheid</div>
      <div style="font-size:10px;color:var(--text3)">voor ${v.make} ${v.model} • ${a.sample_size} verificaties</div></div></div>`;
  } catch(e){}
}
async function fetchGptValidator(v, m, r, calc){
  try {
    // AI validation data is already in r.aiValidation from /api/dealer/price
    // This function renders the detailed view into #gpt-validator
    return; // DISABLED
    const el = document.getElementById('gpt-validator');
    if(!el) return;

    const ai = r.aiValidation;
    // If we already have aiValidation, render detailed view
    if(ai && ai.available){
      const confPct = ai.confidence || r.confidence || 0;
      const confCol = confPct >= 70 ? 'var(--green)' : confPct >= 50 ? 'var(--orange)' : 'var(--red)';

      let flagsHtml = '';
      if(ai.riskFlags?.length){
        flagsHtml = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">' +
          ai.riskFlags.map(f => `<span style="padding:3px 8px;border-radius:6px;font-size:10px;background:rgba(245,166,35,.1);color:var(--orange)">${f}</span>`).join('') +
          '</div>';
      }

      el.innerHTML = `
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-size:12px;font-weight:700;color:var(--text1)">CarDatax AI Validatie</div>
            <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${confPct>=70?'rgba(0,255,156,.1)':confPct>=50?'rgba(255,183,77,.1)':'rgba(255,77,77,.1)'};color:${confCol};font-weight:700">${confPct}%</span>
          </div>
          ${ai.reasoning ? `<div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:6px">${ai.reasoning}</div>` : ''}
          ${ai.marketInsight ? `<div style="font-size:11px;color:var(--text3);font-style:italic;margin-bottom:4px">${ai.marketInsight}</div>` : ''}
          ${ai.transmissieImpact ? `<div style="font-size:11px;color:var(--text3)">Transmissie: ${ai.transmissieImpact}</div>` : ''}
          ${flagsHtml}
        </div>`;
      return;
    }

    // If no AI validation data yet, try fetching separately (fallback)
    const resp = await fetch('/api/gpt-validate', {
      method: 'POST',
      headers: _authH(),
      body: JSON.stringify({
        make: v.make, model: v.model, year: v.year, km: last?.km || 0,
        fuel: v.fuel, bod: calc.bod, handelswaarde: r.handelswaarde,
        verkoopadviees: r.verkoopadviees, marketCount: m?.count || 0,
        marketMedian: m?.median || 0
      })
    });
    const d = await resp.json();
    if(d.ok && d.reasoning){
      el.innerHTML = `
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px">
          <div style="font-size:12px;font-weight:700;color:var(--text1);margin-bottom:6px">CarDatax AI Validatie</div>
          <div style="font-size:12px;color:var(--text2);line-height:1.5">${d.reasoning}</div>
        </div>`;
    }
  } catch(e){
    console.warn('[GptValidator]', e);
  }
}

function toggleSection(id){var b=document.getElementById(id);if(b)b.style.display=b.style.display==="none"?"":"none"}

function render(){
  if(!last)return;
  const{v,m,r,plate,km}=last;

  // ═══ PRICING DATA ═══
  const vp=r.verkoopadviees||r.internetPrijs||0; // Verkoopprijs (retail)
  const hw=r.handelswaarde||Math.round(vp*.88)||0;
  const bodRaw=r.t4cBod||r.handelswaarde||((r.inkoopLow&&r.inkoopHigh)?Math.round((r.inkoopLow+r.inkoopHigh)/2):0);

  // ═══ SCORE MAPPING (from backend scoring module) ═══
  const _sc=r.scores||{};
  const courantScore=_sc.courant?.score||5;
  const vergelijkScore=_sc.vergelijk?.score||5;
  const techniekScore=_sc.techniek?.score||5;
  const margeScore=_sc.marge?.score||5;
  const qualityScore=_sc.quality?.score||5;
  const totalScore=_sc.total?.total||5;
  const totalVerdict=_sc.total?.verdict||'';
  const totalGrade=_sc.total?.grade||'';

  // ═══ INITIAL SLIDER VALUES (auto-prefill) ═══
  const initCourant=Math.min(10,Math.max(1,Math.round(courantScore)));

  // Risicomotor auto-prefill: THP/Ecoboost/DSG/TCe/PureTech = minimaal 6
  const engL=(v.engineLabel||'').toLowerCase(),motC=(v.motorCode||'').toLowerCase(),transD=(v.transmissionDetail||'').toLowerCase();
  const isRiskyEngine=['thp','ecoboost','dsg','tce','puretech','tsi','tfsi','n47','n57','ep6','prince','1.2 tce','1.0 ecoboost','eb2'].some(k=>engL.includes(k)||motC.includes(k)||transD.includes(k));
  const isRiskyTrans=['dsg','dct','powershift','easytronic','selespeed','dualogic','etg'].some(k=>transD.includes(k));
  let initRisico=v.engineRiskProfile==='Hoog'?Math.max(7,Math.round(r.riskScore/10)):Math.round(r.riskScore/12)||3;
  if(isRiskyEngine||isRiskyTrans)initRisico=Math.max(6,initRisico);
  initRisico=Math.min(10,Math.max(1,initRisico));
  const initStaat=7; // Default: redelijk goed

  // Marge Score (klant formule): (ETR×0.4) + (ATR×0.2) - (Risico×0.2) - (KostenDruk×0.2)
  const kostenDruk=Math.min(10,Math.max(1,Math.round(initRisico*0.5+(10-initStaat)*0.5)));
  const margeScoreCalc=margeScore;



  // Auto-detect LCV
  const isLCV=['transporter','caddy','crafter','sprinter','transit','vivaro','trafic','expert','jumpy','boxer','ducato','daily','master','movano','berlingo','partner','kangoo','combo','nv200','proace','hiace','vito'].some(m=>(v.model||'').toLowerCase().includes(m));
  const detectedSeg=isLCV?'lcv':detectSegment(v);

  // Store for recalculation
  window._t4cCalc={vp,hw,bodRaw,plate,v,m,r,km,
    courant:initCourant,risico:initRisico,staat:initStaat,
    segment:detectedSeg,btwAuto:false,seizoen:'neutraal',isLCV,
    toggles:{distributie:false,banden:false,remmen:false,beurt:false,ruit:false,velgen:false,interieur:false},
    overrides:{marge:null,rkBasis:null,seizoenPct:null,btwBonus:null,bpmCorrectie:0},
    verkoopType:'nl'};

  const calc=recalcBod();

  // ═══ WARNINGS ═══
  let w='';
  if(v.importFlag)w+=`<span class="warn warning">${IC.alert} Import</span>`;
  if(v.napFailed||!v.napOk)w+=`<span class="warn danger">${IC.alert} Geen NAP</span>`;
  if(v.stolenFlag)w+=`<span class="warn danger">${IC.alert} GESTOLEN</span>`;
  if(v.isExDealer)w+=`<span class="warn warning">${IC.alert} Ex-bedrijf</span>`;
  if(v.ownerCount>4)w+=`<span class="warn warning">${IC.alert} ${v.ownerCount} eigenaren</span>`;
  if(v.mrb&&v.mrb>800)w+=`<span class="warn money">${IC.euro} Hoge MRB</span>`;
  if(v.emissieKlasse&&/euro\s*[123]/i.test(v.emissieKlasse))w+=`<span class="warn warning">${IC.alert} ${v.emissieKlasse}</span>`;
  if(km>200000)w+=`<span class="warn warning">${IC.tool} Hoge km</span>`;

  // ═══ SUMMARY ═══
  let summary='';
  if(r.smartSummary?.length){
    summary=r.smartSummary.map(s=>'<div style="padding:4px 0;border-bottom:1px solid var(--border-l);font-size:12px;line-height:1.4">'+s+'</div>').join('')
  }

  // Score color helper
  const scClr=(s)=>s>=7?'green':s>=5?'orange':'red';
  const scBg=(s)=>s>=7?'var(--green)':s>=5?'var(--orange)':'var(--red)';

  // Market section with SOLD PRICES prominent
  let mktHtml='';
  if(m&&m.count>0){
    // Sold prices section
    let soldSection = '';
    if(m.soldMedian || m.soldCount > 0){
      soldSection = `<div style="background:rgba(0,255,156,.05);border:1px solid rgba(0,255,156,.15);border-radius:8px;padding:10px 14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span style="font-size:14px">📊</span>
          <span style="font-size:12px;font-weight:700;color:var(--green)">Verkochte prijzen</span>
        </div>
        <div style="font-size:14px;font-weight:800;font-family:var(--mono);color:var(--text1)">
          ${m.soldLow ? E(m.soldLow)+' – '+E(m.soldHigh) : E(m.soldMedian||m.median)}
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">
          ${m.soldCount||0} vergelijkbare auto's verkocht • sterkste prijsindicatie
        </div>
      </div>`;
    }

    mktHtml=`<div class="res-sec" >
      <div class="res-sec-head">Marktanalyse</div>
      <div style="background:var(--green-soft);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--green);display:flex;justify-content:space-between;align-items:center">
        <span>${m.count} vergelijkbare auto's gevonden</span>
        <span style="font-size:10px;color:var(--text3)">meerdere bronnen</span>
      </div>
      ${soldSection}
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <div class="mk-box"><div class="mk-lbl">LAAG (P25)</div><div class="mk-val">${E(m.p25||m.low)}</div></div>
        <div class="mk-box hl"><div class="mk-lbl">MEDIAAN</div><div class="mk-val">${E(m.median||m.avg)}</div></div>
        <div class="mk-box"><div class="mk-lbl">HOOG (P75)</div><div class="mk-val">${E(m.p75||m.high)}</div></div>
      </div>
    </div>`;
  }

  // Barometer position (0-100)
  const baroPos=Math.min(95,Math.max(5,margeScoreCalc*10));

  // Risicomotor badge
  const risicoBadge=(isRiskyEngine||isRiskyTrans)?`<div style="background:rgba(245,166,35,.1);border:1px solid rgba(245,166,35,.2);border-radius:8px;padding:8px 12px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
    <span style="font-size:18px">⚠️</span>
    <div><div style="font-size:12px;font-weight:700;color:var(--orange)">Risicomotor gedetecteerd</div>
    <div style="font-size:11px;color:var(--text3)">${[isRiskyEngine?engL||motC:'',isRiskyTrans?'DSG/DCT bak':''].filter(Boolean).join(' + ')} — risico automatisch op ${initRisico}</div></div>
  </div>`:'';

  document.getElementById('rc').innerHTML=`
    <div style="padding:0 0 20px">

      <!-- ═══ HEADER: Kenteken + Auto ═══ -->
      <div style="padding:16px 0 10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <span class="r-kenteken">${plate}</span>
          ${v.vin?`<span style="font-size:10px;font-family:var(--mono);color:var(--text3);letter-spacing:.5px;margin-top:4px">${v.vin}</span>`:''}
        </div>
        <div class="r-car">${v.make} ${v.model} ${v.generation||v.modelVariant||v.engineLabel||v.subModel||''}</div>
        <div class="r-specs-line">${v.year} • ${N(km||v.km)} km • ${v.fuel||'—'}${v.transmissionType?' • '+v.transmissionType:''} • ${v.body||''}${v.trimLevel?' • '+v.trimLevel:''}</div>
      </div>

      <!-- ═══ TURNTABLE PHOTO VIEWER (hoofdfoto) ═══ -->
      <div class="turntable-wrap" id="turntable-wrap">
        <div class="turntable" id="turntable">
          <div class="turntable-track" id="turntable-track">
            <div class="turntable-slide"><div class="turntable-placeholder"><svg viewBox="0 0 80 40" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1.5" width="80" height="40"><rect x="5" y="15" width="70" height="20" rx="4"/><circle cx="20" cy="35" r="5"/><circle cx="60" cy="35" r="5"/><path d="M15 15 L25 5 L55 5 L65 15"/></svg></div></div>
          </div>
          <div class="turntable-loading" id="turntable-loading">
            <div class="turntable-spinner"></div>
            <span>AI genereert studio foto's...</span>
          </div>
          <div class="turntable-dots" id="turntable-dots"></div>
          <div class="turntable-angle" id="turntable-angle"></div>
          <div class="turntable-hint" id="turntable-hint">↔ Veeg om te draaien</div>
        </div>
      </div>

      <!-- ═══ 360° SPINNER (if captured) ═══ -->
      <div id="spinner-360-wrap" style="display:none">
        <div style="font-size:10px;font-weight:700;color:var(--text4);text-transform:uppercase;letter-spacing:1px;padding:12px 16px 4px">360° Weergave</div>
        <div class="spinner-360" id="spinner-360-el">
          <div class="spinner-360-hint" id="spin-hint">↔ Sleep om te draaien</div>
        </div>
      </div>

      <!-- ═══ DAMAGE SUMMARY (if inspected) ═══ -->
      <div id="damage-summary-wrap" style="display:none"></div>

      <!-- ═══ WARNINGS ═══ -->
      ${w?`<div class="warns">${w}</div>`:''}
      ${risicoBadge}

      <!-- BETROUWBAARHEID VERBORGEN -->
      <div id="confidence-badge" style="display:none"></div>
      <div id="accuracy-badge"></div>

      <div class="tx-col-right"><!-- ═══ 1. PRICE CARD — Sales first ═══ -->
      <div class="price-card-v2">
        <div class="price-main">
          <div>
            <div class="price-main-label">Voorgesteld bod</div>
            <div class="price-main-val" id="live-bod">${E(calc.bod)}</div>
          </div>
          <div style="text-align:right">
            <div class="price-main-label">Verkoopprijs</div>
            <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--text1)">${E(vp)}</div>
          </div>
        </div>
        <div class="price-range">
          <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${E(r.inkoopLow||calc.bod*0.9)}</span>
          <div class="price-range-bar">
            <div class="price-range-fill" style="width:100%"></div>
          </div>
          <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${E(r.inkoopHigh||calc.bod*1.1)}</span>
        </div>
        <div class="price-sub">
          <div class="price-sub-item"><div class="price-sub-label">Marge</div><div class="price-sub-val" id="live-marge" style="color:${calc.marge>2000?'var(--green)':calc.marge>0?'var(--orange)':'var(--red)'}">${E(calc.marge)}</div></div>
          <div class="price-sub-item"><div class="price-sub-label">Handelswaarde</div><div class="price-sub-val">${E(hw)}</div></div>
          <div class="price-sub-item"><div class="price-sub-label">Marge %</div><div class="price-sub-val" id="live-margepct">${calc.margePct}%</div></div>
        </div>
        <div style="text-align:center;margin-top:8px;font-size:10px;color:var(--text4)">Gebaseerd op ${m&&m.count?m.count+' datapunten uit meerdere bronnen':'NL handelsdata, uitvoering, km-stand, opties en huidige marktprijzen'}</div>
      </div>

      <!-- ═══ 2. SCORE BARS ═══ -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px">
        <div class="score-row">
          <span class="score-label">Courantheid</span>
          <div class="score-bar-wrap"><div class="score-bar-fill" style="width:${courantScore*10}%;background:${scBg(courantScore)}"></div></div>
          <span class="score-val ${scClr(courantScore)}">${courantScore.toFixed?courantScore.toFixed(1):courantScore}</span>
        </div>
        <div class="score-row">
          <span class="score-label">Vergelijk</span>
          <div class="score-bar-wrap"><div class="score-bar-fill" style="width:${vergelijkScore*10}%;background:${scBg(vergelijkScore)}"></div></div>
          <span class="score-val ${scClr(vergelijkScore)}">${vergelijkScore.toFixed?vergelijkScore.toFixed(1):vergelijkScore}</span>
        </div>
        <div class="score-row">
          <span class="score-label">Techniek</span>
          <div class="score-bar-wrap"><div class="score-bar-fill" style="width:${techniekScore*10}%;background:${scBg(techniekScore)}"></div></div>
          <span class="score-val ${scClr(techniekScore)}">${techniekScore}</span>
        </div>
        <div class="score-row" style="border-bottom:none;padding-bottom:0">
          <span class="score-label" style="font-weight:700;color:var(--text1)">Marge Score</span>
          <div class="score-bar-wrap" style="height:10px"><div class="score-bar-fill" style="width:${margeScoreCalc*10}%;background:${scBg(margeScoreCalc)}"></div></div>
          <span class="score-val ${scClr(margeScoreCalc)}" style="font-size:20px">${margeScoreCalc}</span>
        </div>
        <div style="font-size:10px;color:var(--text4);text-align:right;margin-top:2px">${margeScoreCalc<=3?'Niet doen':margeScoreCalc<=5?'Alleen scherp':margeScoreCalc<=6?'Acceptabel':margeScoreCalc<=7?'Goed':margeScoreCalc<=8?'Sterk':margeScoreCalc===9?'Top deal':'No-brainer'}</div>

        <!-- Barometer -->
        <div style="margin-top:10px">
          <div class="barometer"><div class="barometer-needle" style="left:${baroPos}%"></div></div>
          <div class="barometer-labels"><span>Niet kopen</span><span>Neutraal</span><span>Kopen</span></div>
        </div>
        ${m&&m.count>0?`<div style="text-align:center;font-size:11px;color:var(--text3);margin-top:8px">Vergelijkbare modellen ${E(m.p25||m.low)} – ${E(m.p75||m.high)}</div>`:''}
      </div>

        <!-- DEALER ADVIES -->
        ${(_sc.advice&&_sc.advice.action)?`<div style="margin:12px 0;padding:12px 14px;border-radius:10px;background:var(--bg3);border-left:4px solid ${_sc.advice.action==='DIRECT KOPEN'||_sc.advice.action==='KOPEN'?'var(--green)':_sc.advice.action==='BIEDEN'?'#4a9eff':_sc.advice.action==='VOORZICHTIG'?'var(--orange)':'var(--red)'}">
          <div style="font-weight:700;font-size:15px;margin-bottom:6px;color:${_sc.advice.action==='DIRECT KOPEN'||_sc.advice.action==='KOPEN'?'var(--green)':_sc.advice.action==='BIEDEN'?'#4a9eff':_sc.advice.action==='VOORZICHTIG'?'var(--orange)':'var(--red)'}">${_sc.advice.action} — ${_sc.total?.verdict||''}</div>
          ${_sc.advice.lines.map(l=>l.startsWith('+ ')?'<div style="font-size:12px;color:var(--green);margin:3px 0">&#9654; '+l.slice(2)+'</div>':l.startsWith('! ')?'<div style="font-size:12px;color:var(--orange);margin:3px 0">&#9888; '+l.slice(2)+'</div>':'<div style="font-size:12px;color:var(--text2);margin:3px 0">'+l+'</div>').join('')}
        </div>`:''}


      </div><!-- /tx-col-right -->
        <div class="tx-col-left"><!-- ═══ 3. SLIDERS — Aanpassing ═══ -->
      <div class="slider-section">
        <div class="slider-section-title" onclick="toggleSection('slider-collapse')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center">${IC.tool} Handmatige aanpassing <span style="font-size:11px">▼</span></div><div id="slider-collapse" style="display:none">

        <!-- Courantheid slider -->
        <div class="slider-row">
          <div class="slider-header">
            <span class="slider-name">Courantheid (bonus)</span>
            <span class="slider-display" id="sl-courant-val">${initCourant}/10 → +${courantBonusPct(initCourant)}%</span>
          </div>
          <input type="range" class="t4c-slider" min="1" max="10" value="${initCourant}" id="sl-courant" oninput="onSlider()">
          <div class="slider-ticks"><span class="slider-tick">1</span><span class="slider-tick">5</span><span class="slider-tick">10</span></div>
        </div>

        <!-- Risico slider -->
        <div class="slider-row">
          <div class="slider-header">
            <span class="slider-name">Risico (correctie)</span>
            <span class="slider-display" id="sl-risico-val">${Math.min(10,Math.max(1,initRisico))}/10 → -${E(risicoCorrectie(Math.min(10,Math.max(1,initRisico))))}</span>
          </div>
          <input type="range" class="t4c-slider" min="1" max="10" value="${Math.min(10,Math.max(1,initRisico))}" id="sl-risico" oninput="onSlider()">
          <div class="slider-ticks"><span class="slider-tick">1 Laag</span><span class="slider-tick">5</span><span class="slider-tick">10 Hoog</span></div>
        </div>

        <!-- Staat slider -->
        <div class="slider-row">
          <div class="slider-header">
            <span class="slider-name">Staat (remarketing)</span>
            <span class="slider-display" id="sl-staat-val">${initStaat}/10 → -${E(staatKosten(initStaat))}</span>
          </div>
          <input type="range" class="t4c-slider" min="1" max="10" value="${initStaat}" id="sl-staat" oninput="onSlider()">
          <div class="slider-ticks"><span class="slider-tick">1 Slecht</span><span class="slider-tick">5</span><span class="slider-tick">10 Nieuwstaat</span></div>
        </div>

        <!-- Segment dropdown -->
        <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
          <span class="slider-name" style="min-width:70px">Segment</span>
          <select class="seg-select" id="sl-segment" onchange="onSlider()">
            <option value="midden" ${window._t4cCalc?.segment==='midden'?'selected':''}>Midden (10%)</option>
            <option value="budget" ${window._t4cCalc?.segment==='budget'?'selected':''}>Budget (12%)</option>
            <option value="premium" ${window._t4cCalc?.segment==='premium'?'selected':''}>Premium (8%)</option>
            <option value="ev" ${window._t4cCalc?.segment==='ev'?'selected':''}>EV (9%)</option>
            <option value="lcv" ${window._t4cCalc?.segment==='lcv'?'selected':''}>LCV (9%)</option>
            <option value="sport" ${window._t4cCalc?.segment==='sport'?'selected':''}>Sport/Niche (14%)</option>
          </select>
        </div>

        <!-- BTW/Marge toggle -->
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
          <span class="slider-name" style="min-width:70px">Type</span>
          <div class="btw-toggle">
            <div class="btw-opt active" id="btw-marge" onclick="setBtw(false)">Marge</div>
            <div class="btw-opt" id="btw-btw" onclick="setBtw(true)">BTW</div>
          </div>
        </div>

        <!-- Export vs NL -->
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
          <span class="slider-name" style="min-width:70px">Verkoop</span>
          <div class="btw-toggle">
            <div class="btw-opt active" id="vt-nl" onclick="setVerkoopType('nl')">NL Retail</div>
            <div class="btw-opt" id="vt-export" onclick="setVerkoopType('export')">Export</div>
          </div>
          <span style="font-size:10px;color:var(--text4)" id="export-info"></span>
        </div>

        <!-- Seizoen -->
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
          <span class="slider-name" style="min-width:70px">Seizoen</span>
          <select class="seg-select" id="sl-seizoen" onchange="onSlider()">
            <option value="neutraal">Neutraal (0%)</option>
            <option value="cabrio_winter">Cabrio winter (-3%)</option>
            <option value="cabrio_zomer">Cabrio zomer (+3%)</option>
            <option value="suv_winter">SUV winter (+2%)</option>
            <option value="diesel_stad">Diesel stad (-2%)</option>
            <option value="schaars">Schaars (+2%)</option>
            <option value="overstock">Overstock (-2%)</option>
          </select>
        </div>

        <!-- BPM Correctie -->
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
          <span class="slider-name" style="min-width:70px">BPM corr.</span>
          <div style="display:flex;align-items:center;gap:4px;flex:1">
            <span style="font-size:11px;color:var(--text3)">-€</span>
            <input type="number" class="override-input" style="width:80px" id="ov-bpm" value="0" min="0" max="10000" oninput="onOverride()">
          </div>
          ${v.bpmRest?`<span style="font-size:10px;color:var(--text4)">Rest BPM: ${E(v.bpmRest)}</span>`:''}
        </div>

        <!-- Manual Overrides (uitklapbaar) -->
        <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
          <div style="font-size:10px;font-weight:700;color:var(--text4);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center" onclick="document.getElementById('overrides-body').classList.toggle('collapsed');this.querySelector('.chevr').classList.toggle('open')">
            Handmatige overrides <span class="chevr" style="transition:transform .2s;font-size:9px">▼</span>
          </div>
          <div id="overrides-body" class="sec-body collapsed">
            <div class="override-row">
              <span class="override-label">Marge % (overschrijf staffel)</span>
              <input type="number" class="override-input" id="ov-marge" placeholder="auto" min="1" max="50" oninput="onOverride()">
              <span style="font-size:10px;color:var(--text4)">%</span>
            </div>
            <div class="override-row">
              <span class="override-label">RK basis (standaard €250)</span>
              <input type="number" class="override-input" id="ov-rk" placeholder="250" min="0" max="2000" oninput="onOverride()">
              <span style="font-size:10px;color:var(--text4)">€</span>
            </div>
            <div class="override-row">
              <span class="override-label">Seizoen % (overschrijf)</span>
              <input type="number" class="override-input" id="ov-seizoen" placeholder="auto" min="-10" max="10" step="0.5" oninput="onOverride()">
              <span style="font-size:10px;color:var(--text4)">%</span>
            </div>
            <div class="override-row">
              <span class="override-label">BTW bonus € (overschrijf)</span>
              <input type="number" class="override-input" id="ov-btw" placeholder="auto" min="0" max="5000" oninput="onOverride()">
              <span style="font-size:10px;color:var(--text4)">€</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ 3b. BOD SLIDER — Sleep je bod, zie marge live ═══ -->
      <div class="slider-section">
        <div class="slider-section-title">${IC.euro} Bod aanpassen</div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
          <span style="font-size:22px;font-weight:800;font-family:var(--mono);color:var(--green)" id="bid-slider-val">${E(calc.bod)}</span>
          <span style="font-size:12px;color:var(--text3)">marge: <strong id="bid-slider-marge" style="color:var(--orange)">${E(vp-calc.bod)}</strong> (<span id="bid-slider-margepct">${vp>0?Math.round((vp-calc.bod)/vp*100):0}</span>%)</span>
        </div>
        <input type="range" class="t4c-slider" min="${Math.round(calc.bod*0.7)}" max="${Math.round(vp*0.95)}" value="${calc.bod}" step="50" id="bid-slider" oninput="onBidSlider()" style="width:100%">
        <div class="slider-ticks"><span class="slider-tick">${E(Math.round(calc.bod*0.7))}</span><span class="slider-tick">Formule: ${E(calc.bod)}</span><span class="slider-tick">${E(Math.round(vp*0.95))}</span></div>
      </div>

      <!-- ═══ 4. MAINTENANCE TOGGLES ═══ -->
      <div class="slider-section">
        <div class="slider-section-title" onclick="toggleSection('onderhoud-collapse')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center">${IC.tool} Onderhoudskosten <span style="font-size:11px">▼</span></div><div id="onderhoud-collapse" style="display:none">
        <div class="toggle-grid">
          <div class="toggle-item" onclick="toggleMaint(this,'distributie')" data-k="distributie">
            <div class="toggle-switch"></div>
            <div class="toggle-info"><div class="toggle-name">Distributie</div><div class="toggle-cost">+€750</div></div>
          </div>
          <div class="toggle-item" onclick="toggleMaint(this,'banden')" data-k="banden">
            <div class="toggle-switch"></div>
            <div class="toggle-info"><div class="toggle-name">Banden nodig</div><div class="toggle-cost">+€300</div></div>
          </div>
          <div class="toggle-item" onclick="toggleMaint(this,'remmen')" data-k="remmen">
            <div class="toggle-switch"></div>
            <div class="toggle-info"><div class="toggle-name">Remmen nodig</div><div class="toggle-cost">+€250</div></div>
          </div>
          <div class="toggle-item" onclick="toggleMaint(this,'beurt')" data-k="beurt">
            <div class="toggle-switch"></div>
            <div class="toggle-info"><div class="toggle-name">Grote beurt</div><div class="toggle-cost">+€400</div></div>
          </div>
          <div class="toggle-item" onclick="toggleMaint(this,'ruit')" data-k="ruit">
            <div class="toggle-switch"></div>
            <div class="toggle-info"><div class="toggle-name">Ruit/ster</div><div class="toggle-cost">+€200</div></div>
          </div>
          <div class="toggle-item" onclick="toggleMaint(this,'velgen')" data-k="velgen">
            <div class="toggle-switch"></div>
            <div class="toggle-info"><div class="toggle-name">Velgenschade</div><div class="toggle-cost">+€150</div></div>
          </div>
          <div class="toggle-item" onclick="toggleMaint(this,'interieur')" data-k="interieur">
            <div class="toggle-switch"></div>
            <div class="toggle-info"><div class="toggle-name">Rook/hond/int.</div><div class="toggle-cost">+€250</div></div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
          <span style="font-size:12px;font-weight:600;color:var(--text2)">Totaal onderhoud</span>
          <span style="font-size:14px;font-weight:800;font-family:var(--mono);color:var(--orange)" id="live-onderhoud">€ 0</span>
        </div>
      </div>

      <!-- ═══ 5. LIVE BOD SAMENVATTING ═══ -->
      <div style="background:linear-gradient(135deg,#0a1a10,#0a150a);border:1px solid var(--green-border);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:12px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:1px">Berekend bod</span>
          <span style="font-size:10px;color:var(--text3)" id="live-formula-note">staffel + sliders</span>
        </div>
        <div style="font-size:32px;font-weight:800;font-family:var(--mono);color:var(--green);letter-spacing:-1px" id="live-bod2">${E(calc.bod)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px" id="live-breakdown">VP ${E(vp)} - marge ${calc.margePctUsed}% - RK €${calc.rkTotal} - risico €${calc.risicoCor} - onderhoud €${calc.onderhoud}${calc.courantBonus>0?' + bonus €'+calc.courantBonus:''}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="ract primary" style="flex:1;padding:10px" onclick="copyBod()">Kopieer bod</button>
          <button class="ract" style="flex:1;padding:10px" onclick="exportPdf()">PDF</button>
        </div>
      </div>

      <!-- ═══ 6. AI INSIGHT (filled async by fetchGptValidator) ═══ -->

      <!-- ═══ SUMMARY ═══ -->
      ${summary?`<div class="sum-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="font-size:14px;font-weight:700;color:var(--text1)">${r.courantLabel||'Marktanalyse'}</div>
          ${false?`<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${r.confidence>=70?'rgba(0,255,156,.1)':r.confidence>=50?'rgba(255,183,77,.1)':'rgba(255,77,77,.1)'};color:${r.confidence>=70?'var(--green)':r.confidence>=50?'var(--orange)':'var(--red)'};font-weight:600">${r.confidence}% vertrouwen</span>`:''}
        </div>
        <div class="sum-text">${summary}</div>
      </div>`:''}

      <!-- ═══ 7. VOERTUIGGEGEVENS (met indicators) ═══ -->
      <div class="res-sec">
        <div class="res-sec-head">Voertuiggegevens</div>
        <div class="dg">
          <div class="dg-row"><span class="dg-l">1e toelating</span><span class="dg-v">${v.firstAdmission||v.year||'—'} ${v.registrationDateNL?'<span style="color:var(--text3);font-size:10px">(NL: '+v.registrationDateNL+')</span>':''}</span></div>
          <div class="dg-row"><span class="dg-l">Km-stand</span><span class="dg-v" style="display:flex;align-items:center;gap:6px">${N(km||v.km)} km <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${v.napOk!==false?'rgba(0,255,156,.1);color:var(--green)':'rgba(239,68,68,.1);color:var(--red)'};font-weight:600">${v.napOk!==false?'✅ NAP':'❌ NAP'}</span></span></div>
          <div class="dg-row"><span class="dg-l">Motor & bak</span><span class="dg-v">${v.fuel||'—'} • ${v.transmissionType||'—'}${v.transmissionDetail?' ('+v.transmissionDetail+')':''}</span></div>
          ${v.powerHp?`<div class="dg-row"><span class="dg-l">Vermogen</span><span class="dg-v">${v.powerHp} pk${v.powerKw?' / '+v.powerKw+' kW':''}</span></div>`:''}
          ${v.timingType?`<div class="dg-row"><span class="dg-l">Distributie</span><span class="dg-v" style="color:${v.timingType.toLowerCase().includes('ketting')?'var(--green)':'var(--orange)'}">${v.timingType} ${v.timingType.toLowerCase().includes('ketting')?'✅':'⚠️'}</span></div>`:''}
          <div class="dg-row"><span class="dg-l">APK tot</span><span class="dg-v" style="color:${v.apkUntil&&new Date(v.apkUntil.split('-').reverse().join('-'))>new Date()?'var(--green)':'var(--orange)'}">${v.apkUntil||'—'} ${v.apkUntil?'✅':'⚠️'}</span></div>
          ${v.ownerCount?`<div class="dg-row"><span class="dg-l">Eigenaren</span><span class="dg-v" style="color:${v.ownerCount<=2?'var(--green)':v.ownerCount<=4?'var(--orange)':'var(--red)'}">${v.ownerCount}x ${v.ownerCount<=2?'✅':v.ownerCount<=4?'⚠️':'❌'}</span></div>`:''}
          ${v.motorCode?`<div class="dg-row"><span class="dg-l">Motorcode</span><span class="dg-v" style="font-family:var(--mono);font-size:12px">${v.motorCode}</span></div>`:''}
          <div class="dg-row"><span class="dg-l">Import</span><span class="dg-v" style="color:${v.importFlag?'var(--red)':'var(--green)'}">${v.importFlag?'❌ Ja':'✅ Nee'}</span></div>
          <div class="dg-row"><span class="dg-l">Gestolen</span><span class="dg-v" style="color:${v.stolenFlag?'var(--red)':'var(--green)'}">${v.stolenFlag?'❌ JA':'✅ Nee'}</span></div>
        </div>
      </div>

      <!-- ═══ 8. WAARDEN IN NEDERLAND ═══ -->
      <div class="res-sec">
        <div class="res-sec-head">Waarden in Nederland</div>
        <div class="dg">
          <div class="dg-row"><span class="dg-l">Handelswaarde</span><span class="dg-v" style="font-weight:700">${E(hw)} <span style="font-size:10px;color:var(--text3)">± ${E(Math.round(hw*0.05))}</span></span></div>
          ${v.catalogPrice?`<div class="dg-row"><span class="dg-l">Nieuwprijs</span><span class="dg-v">${E(v.catalogPrice)}</span></div>`:''}
          ${v.bpmRest||v.bpm?`<div class="dg-row"><span class="dg-l">Rest BPM</span><span class="dg-v">${E(v.bpmRest||0)} <span style="font-size:10px;color:var(--text3)">(${v.bpmRestPct||0}%)</span></span></div>`:''}
          ${v.mrb?`<div class="dg-row"><span class="dg-l">MRB indicatie</span><span class="dg-v">€${N(v.mrb)}/jaar</span></div>`:''}
          ${v.importFlag?`<div class="dg-row"><span class="dg-l">Import</span><span class="dg-v" style="color:var(--red);font-weight:700">❌ Import voertuig</span></div>`:''}
          ${v.co2?`<div class="dg-row"><span class="dg-l">CO₂</span><span class="dg-v">${v.co2} g/km</span></div>`:''}
          ${v.emissieKlasse?`<div class="dg-row"><span class="dg-l">Emissieklasse</span><span class="dg-v">${v.emissieKlasse}</span></div>`:''}
        </div>
      </div>

      <!-- ═══ MARKET ═══ -->
      ${mktHtml}
      <div id="intel-section"></div>
      <div id="gpt-validator" style="display:none"></div>

      <!-- ═══ 9. UITRUSTING / HIGHLIGHTS ═══ -->
      <div class="res-sec">
        <div class="res-sec-head" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('.chevr').classList.toggle('open')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center">Uitrusting & Opties <span class="chevr open" style="transition:transform .2s;font-size:11px">▼</span></div>
        <div class="sec-body">
          ${v.optionPackage?`<div style="background:var(--green);color:#000;border-radius:6px;padding:6px 10px;font-weight:700;font-size:13px;margin-bottom:8px">${v.optionPackage}</div>`:''}
          ${(v.cylinders||v.timingType||v.wheelSize)?`<div class="dg">
            ${v.cylinders?`<div class="dg-row"><span class="dg-l">Motor</span><span class="dg-v">${v.cylinders}-cilinder${v.turbo?' turbo':''}</span></div>`:''}
            ${v.headlightType?`<div class="dg-row"><span class="dg-l">Koplampen</span><span class="dg-v">${v.headlightType}</span></div>`:''}
            ${v.parkingSensors?`<div class="dg-row"><span class="dg-l">Parkeersensoren</span><span class="dg-v">${v.parkingSensors}</span></div>`:''}
            ${v.wheelSize?`<div class="dg-row"><span class="dg-l">Velgen</span><span class="dg-v">${v.wheelSize}</span></div>`:''}
            ${v.interior?`<div class="dg-row"><span class="dg-l">Interieur</span><span class="dg-v">${v.interior}</span></div>`:''}
            ${v.audioSystem?`<div class="dg-row"><span class="dg-l">Audio</span><span class="dg-v">${v.audioSystem}</span></div>`:''}
            ${v.naviType?`<div class="dg-row"><span class="dg-l">Navigatie</span><span class="dg-v">${v.naviType}</span></div>`:''}
            ${v.roofType?`<div class="dg-row"><span class="dg-l">Dak</span><span class="dg-v">${v.roofType}</span></div>`:''}
            ${v.camera?`<div class="dg-row"><span class="dg-l">Camera</span><span class="dg-v">${v.camera}</span></div>`:''}
            ${v.heatedSeats===true?`<div class="dg-row"><span class="dg-l">Stoelverwarming</span><span class="dg-v" style="color:var(--green)">✅ Ja</span></div>`:''}
            ${v.towbar===true?`<div class="dg-row"><span class="dg-l">Trekhaak</span><span class="dg-v" style="color:var(--green)">✅ Ja</span></div>`:''}
          </div>`:v.motorCode?'':`<div style="padding:12px;color:var(--text3);font-size:12px;text-align:center">Voertuiganalyse niet beschikbaar</div>`}
          ${v.standardEquipment?.length?`<div style="margin-top:10px"><div style="font-size:11px;color:var(--text3);font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Standaard bij ${v.trimLevel||'deze uitvoering'}</div><div style="display:flex;flex-wrap:wrap;gap:4px">${v.standardEquipment.map(e=>`<span style="background:var(--card,var(--bg3));border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:11px;color:var(--text2)">${e}</span>`).join('')}</div></div>`:''}
        </div>
      </div>

      <!-- ═══ RISICO-ANALYSE ═══ -->
      <div class="res-sec">
        <div class="res-sec-head" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('.chevr').classList.toggle('open')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center">Risico-analyse <span class="chevr" style="transition:transform .2s;font-size:11px">▼</span></div>
        <div class="sec-body collapsed">
          ${v.engineRiskProfile?`<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 12px;border-radius:8px;background:${v.engineRiskProfile==='Laag'?'rgba(0,255,156,.08)':v.engineRiskProfile==='Hoog'?'rgba(255,77,77,.1)':'rgba(255,183,77,.1)'}">
            <div style="font-size:24px">${v.engineRiskProfile==='Laag'?'✅':v.engineRiskProfile==='Hoog'?'🔴':'🟡'}</div>
            <div><div style="font-weight:700;color:${v.engineRiskProfile==='Laag'?'var(--green)':v.engineRiskProfile==='Hoog'?'var(--red)':'var(--orange)'};font-size:14px">Motorrisico: ${v.engineRiskProfile}</div>${v.engineRiskDetail?`<div style="font-size:12px;color:var(--text2);margin-top:2px">${v.engineRiskDetail}</div>`:''}</div>
          </div>`:''}
          ${v.knownIssues?.length?`<div>${v.knownIssues.map(i=>`<div style="padding:6px 10px;background:rgba(255,183,77,.06);border-left:3px solid var(--orange);margin-bottom:4px;border-radius:0 6px 6px 0;font-size:12px;color:var(--text2)">${i}</div>`).join('')}</div>`:''}
        </div>
      </div>

      <!-- ═══ ACTIONS ═══ -->
      <div class="result-actions">
        <button class="ract primary" onclick="navigator.share?.({title:'CarDatax',text:'${v.make} ${v.model} ${v.year}\\nBod: '+document.getElementById('live-bod2').textContent+'\\nRetail: ${E(vp)}\\n${plate}'}).catch(()=>{copyBod()})">
          ${IC.share} Deel
        </button>
        <button class="ract" onclick="go('walkaround')">
          ${IC.inspect} Inspectie
        </button>
        <button class="ract" style="flex:1" onclick="exportPdf()">PDF</button>
      </div>

      </div><!-- /tx-col-left -->
        <!-- ═══ POST-TAXATIE: Wat wil je doen? ═══ -->
      <div style="margin:16px 0 8px;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Wat wil je met deze auto?</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
        <button onclick="showVoorraadModal()" style="padding:14px 8px;background:var(--green);color:#000;border:none;border-radius:12px;cursor:pointer;font-family:var(--font);font-weight:700;font-size:13px">+ Voorraad</button>
        <button onclick="showVeilingModal()" style="padding:14px 8px;background:rgba(77,166,255,.15);color:#4da6ff;border:1px solid rgba(77,166,255,.2);border-radius:12px;cursor:pointer;font-family:var(--font);font-weight:700;font-size:13px">⚡ Veiling</button>
        <button onclick="doAddInkoop()" style="padding:14px 8px;background:var(--bg3);color:var(--text2);border:1px solid var(--border-l);border-radius:12px;cursor:pointer;font-family:var(--font);font-weight:700;font-size:13px">⟳ Inkoop</button>
      </div>

      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="ract" style="flex:1" onclick="document.getElementById('vt-plate').value=fmtP('${last.plate.replace(/-/g,'')}');go('verkooptekst')">
          ${IC.pen} Verkooptekst genereren
        </button>
      </div>

      <!-- Voorraad modal -->
      <div id="voorraad-modal" style="display:none">
        <div style="background:var(--bg2);border:1px solid var(--border-l);border-radius:var(--radius);padding:16px;margin-top:12px">
          <div style="font-size:14px;font-weight:700;color:var(--text1);margin-bottom:12px">+ Toevoegen aan voorraad</div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Vraagprijs</div>
          <div class="km-container" style="margin-bottom:12px"><input id="voorraad-prijs" class="km-input" type="number" style="font-size:18px" placeholder="${r.verkoopadviees||r.internetPrijs||'0'}"><span class="km-suf" style="right:16px">€</span></div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Foto's uploaden (optioneel)</div>
          <div id="voorraad-photos" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>
          <label style="display:flex;align-items:center;justify-content:center;gap:6px;padding:12px;border:2px dashed var(--border-l);border-radius:10px;color:var(--text3);font-size:12px;cursor:pointer;margin-bottom:12px">
            <input type="file" id="voorraad-files" accept="image/*" multiple style="display:none" onchange="previewPhotos(this.files,'voorraad-photos')">
            📷 Klik om foto's te selecteren
          </label>
          <div style="display:flex;gap:8px">
            <button class="act-btn" onclick="document.getElementById('voorraad-modal').style.display='none'" style="flex:1">Annuleer</button>
            <button class="act-btn primary" onclick="doAddVoorraad()" style="flex:1" id="btn-voorraad-add">Toevoegen</button>
          </div>
        </div>
      </div>

      <!-- Veiling modal -->
      <div id="veiling-modal" style="display:none">
        <div style="background:var(--bg2);border:1px solid rgba(77,166,255,.15);border-radius:var(--radius);padding:16px;margin-top:12px">
          <div style="font-size:14px;font-weight:700;color:#4da6ff;margin-bottom:12px">⚡ Direct in veiling plaatsen</div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Minimumprijs (bod moet minimaal dit zijn)</div>
          <div class="km-container" style="margin-bottom:8px"><input id="veiling-min" class="km-input" type="number" style="font-size:18px" placeholder="${r.inkoopLow||'0'}"><span class="km-suf" style="right:16px">€</span></div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Veiling duur</div>
          <select id="veiling-duur" style="width:100%;padding:10px 12px;background:var(--bg3);border:1px solid var(--border-l);border-radius:8px;color:var(--text1);font-size:13px;margin-bottom:10px;font-family:var(--font)">
            <option value="24">24 uur</option>
            <option value="48">48 uur</option>
            <option value="72">72 uur</option>
          </select>
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Foto's uploaden (optioneel)</div>
          <div id="veiling-photos" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>
          <label style="display:flex;align-items:center;justify-content:center;gap:6px;padding:12px;border:2px dashed rgba(77,166,255,.15);border-radius:10px;color:var(--text3);font-size:12px;cursor:pointer;margin-bottom:12px">
            <input type="file" id="veiling-files" accept="image/*" multiple style="display:none" onchange="previewPhotos(this.files,'veiling-photos')">
            📷 Klik om foto's te selecteren
          </label>
          <div style="display:flex;gap:8px">
            <button class="act-btn" onclick="document.getElementById('veiling-modal').style.display='none'" style="flex:1">Annuleer</button>
            <button class="act-btn primary" onclick="doAddVeiling()" style="flex:1" id="btn-veiling-add" style="background:#4da6ff">Veiling starten</button>
          </div>
        </div>
      </div>
    </div>`;

  // Attach slider listeners after DOM update
  setTimeout(()=>{
    document.getElementById('sl-segment')?.setAttribute('value',window._t4cCalc.segment);
    // Photo carousel swipe
    // Init turntable + other viewers
    // 360° spinner (if captured in walkaround)
    init360Spinner();
    // Damage summary (if inspected)
    renderDamageSummary();
  },50);
}

// ═══ 360° SPINNER VIEWER ═══
function init360Spinner(){
  const photos=window._t4c360;
  const wrap=document.getElementById('spinner-360-wrap');
  const el=document.getElementById('spinner-360-el');
  if(!photos||photos.length<3||!wrap||!el)return;

  wrap.style.display='block';

  // Build images
  let html='';
  photos.forEach((p,i)=>{
    html+='<img src="'+p.url+'" class="'+(i===0?'spin-active':'')+'" data-spin="'+i+'">';
  });
  html+='<div class="spinner-360-dots">'+photos.map((_,i)=>'<div class="spin-dot'+(i===0?' active':'')+'"></div>').join('')+'</div>';
  html+='<div class="spinner-360-hint" id="spin-hint">↔ Sleep om te draaien</div>';
  el.innerHTML=html;

  let spinIdx=0,spinStartX=0;
  const total=photos.length;
  const updateSpin=(idx)=>{
    el.querySelectorAll('img[data-spin]').forEach((img,i)=>{img.classList.toggle('spin-active',i===idx)});
    el.querySelectorAll('.spin-dot').forEach((d,i)=>{d.classList.toggle('active',i===idx)});
  };

  // Touch (mobile)
  el.addEventListener('touchstart',e=>{spinStartX=e.touches[0].clientX;document.getElementById('spin-hint')?.remove()},{passive:true});
  el.addEventListener('touchmove',e=>{
    const dx=e.touches[0].clientX-spinStartX;
    if(Math.abs(dx)>20){
      spinIdx=(spinIdx+(dx>0?-1:1)+total)%total;
      updateSpin(spinIdx);
      spinStartX=e.touches[0].clientX;
    }
  },{passive:true});

  // Mouse (desktop)
  let dragging=false;
  el.addEventListener('mousedown',e=>{dragging=true;spinStartX=e.clientX;document.getElementById('spin-hint')?.remove()});
  document.addEventListener('mousemove',e=>{
    if(!dragging)return;
    const dx=e.clientX-spinStartX;
    if(Math.abs(dx)>20){
      spinIdx=(spinIdx+(dx>0?-1:1)+total)%total;
      updateSpin(spinIdx);
      spinStartX=e.clientX;
    }
  });
  document.addEventListener('mouseup',()=>{dragging=false});
}

// ═══ DAMAGE SUMMARY IN RESULT ═══
function renderDamageSummary(){
  const wrap=document.getElementById('damage-summary-wrap');
  if(!wrap||!damages||damages.length===0)return;

  wrap.style.display='block';
  const totalCost=damages.reduce((s,d)=>s+(d.cost||0),0);
  const sevColors={licht:'var(--green)',gemiddeld:'var(--yellow)',ernstig:'var(--red)'};

  let html='<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);margin:8px 16px;overflow:hidden">';
  html+='<div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">';
  html+='<div style="font-size:12px;font-weight:700;color:var(--text1)">🔍 Schade-inspectie</div>';
  html+='<div style="font-size:12px;font-weight:700;color:var(--red)">'+damages.length+' punt'+(damages.length>1?'en':'')+' — €'+totalCost.toLocaleString('nl-NL')+'</div>';
  html+='</div>';

  damages.forEach(d=>{
    html+='<div style="padding:8px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">';
    html+='<span style="color:'+(sevColors[d.severity]||'var(--text3)')+';font-size:14px">●</span>';
    html+='<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:var(--text1)">'+d.zone+'</div>';
    html+='<div style="font-size:10px;color:var(--text3)">'+d.type+' — '+d.severity+'</div></div>';
    html+='<div style="font-size:12px;font-weight:700;color:var(--red);font-family:var(--mono)">€'+d.cost+'</div>';
    html+='</div>';
  });

  html+='</div>';
  wrap.innerHTML=html;
}

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
  document.getElementById('veiling-modal').style.display='none';
  const m=document.getElementById('voorraad-modal');
  m.style.display='block';
  const input=document.getElementById('voorraad-prijs');
  input.value=last?.r?.verkoopadviees||last?.r?.internetPrijs||'';
  input.focus();
  document.getElementById('voorraad-photos').innerHTML='';
  document.getElementById('voorraad-files').value='';
}

function showVeilingModal(){
  document.getElementById('voorraad-modal').style.display='none';
  const m=document.getElementById('veiling-modal');
  m.style.display='block';
  const input=document.getElementById('veiling-min');
  input.value=last?.r?.inkoopLow||last?.r?.handelswaarde||'';
  input.focus();
  document.getElementById('veiling-photos').innerHTML='';
  document.getElementById('veiling-files').value='';
}

function previewPhotos(files, containerId){
  const c=document.getElementById(containerId);
  c.innerHTML='';
  for(let i=0;i<files.length;i++){
    const reader=new FileReader();
    reader.onload=function(e){
      c.insertAdjacentHTML('beforeend','<div style="width:56px;height:56px;border-radius:8px;overflow:hidden;border:1px solid var(--border-l);flex-shrink:0"><img src="'+e.target.result+'" style="width:100%;height:100%;object-fit:cover"></div>');
    };
    reader.readAsDataURL(files[i]);
  }
}

async function uploadPhotosForCar(carId, fileInputId){
  const files=document.getElementById(fileInputId)?.files;
  if(!files||!files.length)return;
  let uploaded=0;
  for(let i=0;i<files.length;i++){
    try{
      const res=await fetch('/api/voorraad/'+carId+'/photos',{
        method:'POST',
        headers:{'Authorization':'Bearer '+_t4cToken(),'Content-Type':files[i].type||'image/jpeg'},
        body:files[i]
      });
      const d=await res.json();
      if(d.ok)uploaded++;
    }catch(e){console.error('Photo upload failed:',e)}
  }
  if(uploaded>0)toast(uploaded+' foto\'s geüpload','success');
}

async function doAddVoorraad(){
  if(!last)return;
  const{v,r,plate,km}=last;
  const prijs=document.getElementById('voorraad-prijs').value;
  if(!prijs)return toast('Voer een vraagprijs in','warning');
  const btn=document.getElementById('btn-voorraad-add');
  btn.textContent='Bezig...';btn.disabled=true;
  try{
    const res=await fetch('/api/voorraad/add',{method:'POST',headers:_authH(),body:JSON.stringify({kenteken:plate,make:v.make,model:v.model,model_variant:v.modelVariant||v.subModel||'',year:v.year,fuel:v.fuel,km:km||0,color:v.color,body:v.body,power_kw:v.powerKw,power_hp:v.powerHp,engine_label:v.engineLabel,transmission:v.transmissionType||'',vraag_prijs:Number(prijs),beschrijving:'',highlights:'',apk_until:v.apkUntil||'',vin:v.vin||'',status:'te_koop',featured:false})});
    const d=await res.json();
    if(d.ok){
      await uploadPhotosForCar(d.id||d.voorraad_id,  'voorraad-files');
      toast('Toegevoegd aan voorraad!','success');
      document.getElementById('voorraad-modal').style.display='none';
    }
    else toast(d.error||'Server fout','error');
  }catch{toast('Er ging iets mis','error')}
  btn.textContent='Toevoegen';btn.disabled=false;
}

async function doAddVeiling(){
  if(!last)return;
  const{v,r,plate,km}=last;
  const minPrijs=document.getElementById('veiling-min').value;
  if(!minPrijs)return toast('Voer een minimumprijs in','warning');
  const duur=parseInt(document.getElementById('veiling-duur').value)||24;
  const btn=document.getElementById('btn-veiling-add');
  btn.textContent='Bezig...';btn.disabled=true;
  try{
    // First add to voorraad (veiling needs a voorraad_id for photos)
    const vRes=await fetch('/api/voorraad/add',{method:'POST',headers:_authH(),body:JSON.stringify({kenteken:plate,make:v.make,model:v.model,model_variant:v.modelVariant||v.subModel||'',year:v.year,fuel:v.fuel,km:km||0,color:v.color,body:v.body,power_kw:v.powerKw,power_hp:v.powerHp,engine_label:v.engineLabel,transmission:v.transmissionType||'',vraag_prijs:Number(minPrijs),apk_until:v.apkUntil||'',vin:v.vin||'',status:'veiling'})});
    const vd=await vRes.json();
    const voorraadId=vd.id||vd.voorraad_id||null;

    // Upload photos to voorraad
    if(voorraadId) await uploadPhotosForCar(voorraadId, 'veiling-files');

    // Create veiling
    const res=await fetch('/api/veiling',{method:'POST',headers:_authH(),body:JSON.stringify({kenteken:plate,merk:v.make,model:v.model,bouwjaar:v.year,km:km||0,brandstof:v.fuel,kleur:v.color||'',minimumprijs:Number(minPrijs),duur_uren:duur,voorraad_id:voorraadId,titel:v.make+' '+v.model+' '+(v.modelVariant||''),beschrijving:r.smartSummary?.slice(0,3).join('. ')||''})});
    const d=await res.json();
    if(d.ok){
      toast('Veiling gestart! '+duur+'u countdown loopt','success');
      document.getElementById('veiling-modal').style.display='none';
    }
    else toast(d.error||'Server fout','error');
  }catch(e){toast('Er ging iets mis: '+e.message,'error')}
  btn.textContent='Veiling starten';btn.disabled=false;
}

async function doAddInkoop(){
  if(!last)return;
  const{v,r,plate,km}=last;
  try{
    const res=await fetch('/api/inkoop',{method:'POST',headers:_authH(),body:JSON.stringify({kenteken:plate,make:v.make,model:v.model,year:v.year,geschatte_waarde:r.handelswaarde||r.verkoopadviees||0,ons_bod:r.inkoopLow||0,contact_naam:'',contact_tel:'',status:'nieuw'})});
    const d=await res.json();
    if(d.ok) toast('Opgeslagen in inkoop pipeline','success');
    else toast(d.error||'Fout','error');
  }catch{toast('Er ging iets mis','error')}
}

async function exportPdf(){
  if(!last)return;
  toast('PDF genereren...','info',2000);
  const calc=recalcBod();
  const c=window._t4cCalc||{};
  try{
    const r=await fetch('/api/pdf',{method:'POST',headers:_authH(),body:JSON.stringify({
      vehicle:{make:last.v.make,model:last.v.model,year:last.v.year,fuel:last.v.fuel,plate:last.plate,body:last.v.body||"",powerHp:last.v.powerHp,powerKw:last.v.powerKw,transmissionType:last.v.transmissionType||"",engineLabel:last.v.engineLabel||"",subModel:last.v.subModel||"",trimLevel:last.v.trimLevel||"",vin:last.v.vin||"",motorCode:last.v.motorCode||"",catalogPrice:last.v.catalogPrice,bpm:last.v.bpm,bpmRest:last.v.bpmRest||0,ownerCount:last.v.ownerCount||0,apkUntil:last.v.apkUntil||"",engineRiskProfile:last.v.engineRiskProfile||"",courantScore:last.v.courantScore||0,napOk:last.v.napOk,importFlag:last.v.importFlag,stolenFlag:last.v.stolenFlag,co2:last.v.co2,emissieKlasse:last.v.emissieKlasse,mrb:last.v.mrb},result:{verkoopadviees:last.r.verkoopadviees,handelswaarde:last.r.handelswaarde,inkoopLow:last.r.inkoopLow,inkoopHigh:last.r.inkoopHigh,internetPrijs:last.r.internetPrijs,t4cBod:calc.bod,confidence:last.r.confidence||0,confidenceLabel:last.r.confidenceLabel||"",courantLabel:last.r.courantLabel||"",sellSpeed:last.r.sellSpeed||"",riskScore:last.r.riskScore||0,smartSummary:last.r.smartSummary||[],aiValidation:last.r.aiValidation||null},market:{count:last.m?.count||0,avg:last.m?.avg||0,median:last.m?.median||0,p25:last.m?.p25||0,p75:last.m?.p75||0},km:last.km,
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
      confidence:last.r.confidence||0,
      intel:last.intel||null
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
function handleFoto(input){
  if(!input.files?.length)return;
  for(const f of input.files) fotoFiles.push(f);
  renderFotos();
  input.value=''; // reset so same file can be added again
}
function renderFotos(){
  const el=document.getElementById('fotolist');
  const countEl=document.getElementById('foto-count');
  const uploadBtn=document.getElementById('foto-upload-btn');
  if(!fotoFiles.length){
    el.innerHTML='';
    countEl.style.display='none';
    uploadBtn.style.display='none';
    return;
  }
  countEl.style.display='block';
  countEl.textContent=fotoFiles.length+' foto'+(fotoFiles.length>1?"'s":"");
  uploadBtn.style.display='block';
  el.innerHTML=fotoFiles.map((f,i)=>{
    const url=URL.createObjectURL(f);
    return `<div class="foto-preview"><img src="${url}"><button class="foto-del" onclick="delFoto(${i})">✕</button><div style="position:absolute;bottom:8px;left:8px;background:rgba(0,0,0,.7);color:var(--text2);font-size:11px;padding:3px 8px;border-radius:6px;backdrop-filter:blur(8px)">${i+1}/${fotoFiles.length}</div></div>`;
  }).join('');
}
function delFoto(i){
  fotoFiles.splice(i,1);
  renderFotos();
  toast('Foto verwijderd','info',1500);
}
async function uploadFotos(){
  const plate=document.getElementById('foto-plate').value.replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
  if(!plate||plate.length<5)return toast('Voer een kenteken in om te uploaden','warning');
  if(!fotoFiles.length)return toast('Geen fotos geselecteerd','warning');
  const btn=document.getElementById('foto-upload-btn');
  btn.disabled=true;btn.textContent='Uploaden...';
  let ok=0;
  for(const f of fotoFiles){
    try{
      const reader=new FileReader();
      const b64=await new Promise((res,rej)=>{reader.onload=()=>res(reader.result.split(',')[1]);reader.onerror=rej;reader.readAsDataURL(f)});
      const r=await fetch('/api/voorraad/plate/'+plate+'/photos',{method:'POST',headers:_authH(),body:JSON.stringify({image:b64,filename:f.name})});
      if((await r.json()).ok)ok++;
    }catch{}
  }
  btn.disabled=false;btn.textContent='Upload naar voorraad';
  if(ok>0){toast(ok+' foto'+(ok>1?"'s":"")+' geüpload','success');fotoFiles=[];renderFotos();}
  else toast('Upload mislukt','error');
}

// ═══ AUTO-GENERATE CAR IMAGES — TURNTABLE (DALL-E 3) ═══
async function generateCarImages(data){
  if(!data||!data.v) return;
  const {v,plate}=data;
  const plateClean=(plate||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
  if(!plateClean) return;

  const loading=document.getElementById('turntable-loading');

  try{
    // 1. Check cache first (instant)
    const cacheR=await fetch('/api/car-images/'+plateClean);
    const cache=await cacheR.json();
    if(cache.ok && cache.images?.length>=4){
      console.log('[Turntable] Cache hit:',cache.images.length);
      if(loading) loading.style.display='none';
      buildTurntable(cache.images);
      return;
    }

    // 2. Generate new images
    if(loading) loading.style.display='flex';
    const genR=await fetch('/api/generate-car-images',{
      method:'POST',
      headers:{'Content-Type':'application/json',..._authH()},
      body:JSON.stringify({
        make:v.make, model:v.model, year:v.year,
        color:v.color, colorSecondary:v.colorSecondary,
        body:v.body, plate:plate,
        variant:v.modelVariant||'', generation:v.generation||'',
        subModel:v.subModel||'', trimLevel:v.trimLevel||''
      })
    });
    const gen=await genR.json();

    if(loading) loading.style.display='none';

    if(gen.error){
      console.warn('[Turntable] Error:',gen.error);
      return;
    }

    const imgs=(gen.images||[]).filter(i=>i.url);
    if(imgs.length>0){
      console.log('[Turntable] Generated:',imgs.length,'images');
      buildTurntable(imgs);
    }
  }catch(err){
    console.error('[Turntable]',err);
    if(loading) loading.style.display='none';
  }
}

function buildTurntable(images){
  const track=document.getElementById('turntable-track');
  const dotsWrap=document.getElementById('turntable-dots');
  const angleLabel=document.getElementById('turntable-angle');
  const hint=document.getElementById('turntable-hint');
  const loading=document.getElementById('turntable-loading');
  if(!track) return;

  const labels={'1-front':'Voorkant','2-front-right':'Rechts-voor','3-right':'Rechterzijde','4-rear':'Achterkant','5-left':'Linkerzijde',front:'Voorkant',left:'Linkerzijde',rear:'Achterkant',right:'Rechterzijde','front-right':'Rechts-voor'};
  const order=['1-front','2-front-right','3-right','4-rear','5-left'];
  const sorted=order.map(a=>images.find(i=>i.angle===a)).filter(Boolean);
  const imgs=sorted.length>=3?sorted:images.filter(i=>i.url);
  if(!imgs.length) return;

  if(loading) loading.style.display='none';

  // Build slides
  const ts=Date.now();
  track.innerHTML=imgs.map(img=>`<div class="turntable-slide"><img src="${img.url}?t=${ts}" alt="${labels[img.angle]||''}" onerror="this.parentElement.innerHTML='<div class=turntable-placeholder><svg viewBox=\\'0 0 80 40\\' fill=\\'none\\' stroke=\\'rgba(255,255,255,.15)\\' stroke-width=\\'1.5\\' width=\\'80\\' height=\\'40\\'><rect x=\\'5\\' y=\\'15\\' width=\\'70\\' height=\\'20\\' rx=\\'4\\'/><circle cx=\\'20\\' cy=\\'35\\' r=\\'5\\'/><circle cx=\\'60\\' cy=\\'35\\' r=\\'5\\'/></svg></div>'"></div>`).join('');

  // Build dots
  if(dotsWrap){
    dotsWrap.innerHTML=imgs.map((_,i)=>`<div class="turntable-dot${i===0?' active':''}" data-ti="${i}"></div>`).join('');
    dotsWrap.style.display='flex';
  }

  // Show angle label + hint
  if(angleLabel){angleLabel.textContent=labels[imgs[0].angle]||'';angleLabel.style.display='block';}
  if(hint){hint.style.display='block';setTimeout(()=>{hint.style.opacity='0';setTimeout(()=>{hint.style.display='none'},500)},3000);}

  // ═══ SWIPE LOGIC — draaitafel effect ═══
  let cur=0,sx=0,dx=0,swiping=false;
  const total=imgs.length;

  function goTo(i){
    cur=((i%total)+total)%total;
    track.style.transform=`translateX(-${cur*100}%)`;
    document.querySelectorAll('.turntable-dot').forEach((d,j)=>d.classList.toggle('active',j===cur));
    if(angleLabel) angleLabel.textContent=labels[imgs[cur].angle]||'';
  }

  track.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;dx=0;swiping=true;track.style.transition='none'},{passive:true});
  track.addEventListener('touchmove',e=>{
    if(!swiping) return;
    dx=e.touches[0].clientX-sx;
    const offset=-cur*100+(dx/track.parentElement.offsetWidth)*100;
    track.style.transform=`translateX(${offset}%)`;
  },{passive:true});
  track.addEventListener('touchend',()=>{
    if(!swiping) return;
    swiping=false;
    track.style.transition='transform .3s cubic-bezier(.25,.46,.45,.94)';
    if(Math.abs(dx)>40){goTo(dx<0?cur+1:cur-1)}else{goTo(cur)}
  });

  let md=false;
  track.addEventListener('mousedown',e=>{md=true;sx=e.clientX;dx=0;track.style.transition='none';e.preventDefault()});
  track.addEventListener('mousemove',e=>{
    if(!md) return;
    dx=e.clientX-sx;
    const offset=-cur*100+(dx/track.parentElement.offsetWidth)*100;
    track.style.transform=`translateX(${offset}%)`;
  });
  track.addEventListener('mouseup',()=>{
    if(!md) return;
    md=false;
    track.style.transition='transform .3s cubic-bezier(.25,.46,.45,.94)';
    if(Math.abs(dx)>40){goTo(dx<0?cur+1:cur-1)}else{goTo(cur)}
  });
  track.addEventListener('mouseleave',()=>{
    if(md){md=false;track.style.transition='transform .3s cubic-bezier(.25,.46,.45,.94)';goTo(cur)}
  });

  document.querySelectorAll('.turntable-dot').forEach(d=>{
    d.addEventListener('click',()=>{track.style.transition='transform .3s cubic-bezier(.25,.46,.45,.94)';goTo(parseInt(d.dataset.ti))});
  });
}

function renderRecent(){
  const el=document.getElementById('rlist');
  const countEl=document.getElementById('rcount');
  if(!recent.length){
    el.innerHTML='<div style="text-align:center;padding:60px 20px"><div style="font-size:32px;margin-bottom:12px;opacity:.3">📋</div><p style="color:var(--text3);font-size:14px">Nog geen taxaties</p><p style="color:var(--text4);font-size:12px;margin-top:4px">Je recente taxaties verschijnen hier</p></div>';
    countEl.textContent='';
    return;
  }
  countEl.textContent=recent.length+' taxatie'+(recent.length>1?'s':'');
  el.innerHTML=recent.map(r=>{
    const ago=r.ts?timeAgo(r.ts):'';
    return `<div class="ri" onclick="document.getElementById('mp').value='${r.plate.replace(/-/g,'')}';go('taxatie')"><div class="ri-left"><div class="ri-plate">${fmtP(r.plate)}</div><div class="ri-car">${r.make||''} ${r.model||''} ${r.year||''}</div>${ago?'<div class="ri-time">'+ago+'</div>':''}</div><div class="ri-price">${r.bod?E(r.bod):''}</div></div>`;
  }).join('');
}

function timeAgo(ts){
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60)return 'zojuist';
  if(s<3600)return Math.floor(s/60)+'m geleden';
  if(s<86400)return Math.floor(s/3600)+'u geleden';
  if(s<604800)return Math.floor(s/86400)+'d geleden';
  return new Date(ts).toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
}

// ═══ VERKOOPTEKST GENERATOR ═══
function selVtStyle(btn){
  document.querySelectorAll('.vt-style').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  vtStyle=btn.dataset.s;
}
async function generateVerkooptekst(){
  const plate=document.getElementById('vt-plate').value.replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
  if(!plate||plate.length<5)return toast('Voer een kenteken in','warning');
  const btn=document.getElementById('vt-btn');
  btn.disabled=true;btn.textContent='Bezig...';
  try{
    const vR=await fetch('/api/vehicle/enriched?plate='+plate);
    const v=await vR.json();
    if(!v||!v.make)throw new Error('Voertuig niet gevonden');
    const prijs=document.getElementById('vt-prijs').value;
    const extra=document.getElementById('vt-extra').value;
    const r=await fetch('/api/verkooptekst',{method:'POST',headers:_authH(),body:JSON.stringify({
      make:v.make,model:v.model,year:v.year,km:v.km,fuel:v.fuel,
      power:v.powerHp,transmission:v.transmissionType||'',color:v.color||'',
      body:v.body||'',apk:v.apkUntil||'',catalogPrice:v.catalogPrice,
      engineLabel:v.engineLabel||'',subModel:v.subModel||'',trimLevel:v.trimLevel||'',
      interior:v.interior||'',drivetrain:v.drivetrain||'',ownerCount:v.ownerCount||0,
      heatedSeats:!!v.heatedSeats,towbar:!!v.towbar,camera:v.camera||'',
      naviType:v.naviType||'',roofType:v.roofType||'',parkingSensors:v.parkingSensors||'',
      audioSystem:v.audioSystem||'',
      vraagprijs:prijs||null,extra:extra,style:vtStyle
    })});
    const d=await r.json();
    if(d.ok){
      document.getElementById('vt-output').textContent=d.text;
      document.getElementById('vt-result').style.display='block';
      document.getElementById('vt-charcount').textContent=d.text.length+' tekens';
      if(vtStyle==='marktplaats' && d.text.length>2000){
        document.getElementById('vt-charcount').style.color='var(--orange)';
        document.getElementById('vt-charcount').textContent=d.text.length+'/2000 tekens ⚠';
      } else {
        document.getElementById('vt-charcount').style.color='var(--text4)';
      }
      document.getElementById('vt-result').scrollIntoView({behavior:'smooth',block:'nearest'});
    }else{toast(d.error||'Er ging iets mis','error')}
  }catch(e){toast(e.message,'error')}
  finally{btn.disabled=false;btn.textContent='Genereer verkooptekst'}
}
function copyVt(){
  const t=document.getElementById('vt-output').textContent;
  navigator.clipboard?.writeText(t).then(()=>toast('Gekopieerd naar klembord','success')).catch(()=>{
    const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('Gekopieerd naar klembord','success');
  });
}
function shareVtWhatsApp(){
  const t=document.getElementById('vt-output').textContent;
  if(!t)return;
  window.open('https://wa.me/?text='+encodeURIComponent(t),'_blank');
}

// Format km input
document.getElementById('mk')?.addEventListener('input',function(){
  const v=this.value.replace(/[^0-9]/g,'');
  this.value=v?Number(v).toLocaleString('nl-NL'):''
});
// Register PWA service worker
if('serviceWorker' in navigator) navigator.serviceWorker.register('/m/sw.js').catch(()=>{});

// ═══ PLATE SCANNER v3 — Yellow detect + Multi-threshold + RDW validation ═══
let scanStream = null;
let scannedPlate = '';
let _scanBusy = false;
let _torchOn = false;
let _plateDetectedFrames = 0;
let _lastDetectTime = 0;
let _lastPlateRect = null;
let _missFrames = 0;
