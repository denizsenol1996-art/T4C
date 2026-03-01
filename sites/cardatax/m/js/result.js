/* ═══════════════════════════════════════
   CarDatax Mobile — Result View (render)
   ═══════════════════════════════════════ */
function render(){
  if(!last)return;
  const{v,m,r,plate,km}=last;

  // ═══ PRICING DATA ═══
  const vp=r.verkoopadviees||r.internetPrijs||0; // Verkoopprijs (retail)
  const hw=r.handelswaarde||Math.round(vp*.88)||0;
  const bodRaw=r.t4cBod||r.handelswaarde||((r.inkoopLow&&r.inkoopHigh)?Math.round((r.inkoopLow+r.inkoopHigh)/2):0);

  // ═══ SCORE MAPPING (backend → 1-10 display) ═══
  const courantScore=v.courantScore||r.etr||r.etrScore||Math.round((r.liquidityScore+(r.marketVelocity||50))/20)||5;
  const vergelijkScore=r.itr||r.itrScore||Math.min(10,Math.round((r.confidence||50)/10))||5;
  const techniekScore=v.engineRiskProfile==='Laag'?8:v.engineRiskProfile==='Hoog'?3:v.engineRiskProfile==='Gemiddeld'?5:6;
  const margeScore=r.apr||r.aprScore||Math.round((courantScore*0.4+vergelijkScore*0.2+(10-r.riskScore/10)*0.2))||5;

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
  const margeScoreCalc=Math.min(10,Math.max(1,Math.round(
    (courantScore*0.4)+(vergelijkScore*0.2)-((initRisico/10)*10*0.2)-(kostenDruk*0.2)
  )));

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

  // Market section
  let mktHtml='';
  if(m&&m.count>0){
    mktHtml=`<div class="res-sec">
      <div class="res-sec-head">Marktanalyse</div>
      <div style="background:var(--green-soft);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--green)">
        ${m.count} vergelijkbare auto's gevonden
      </div>
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

      <!-- ═══ HEADER: Kenteken + VIN ═══ -->
      <div style="padding:16px 16px 12px;border-bottom:2px solid var(--green)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:inline-flex;align-items:center;background:#f5c518;border-radius:4px;overflow:hidden;height:38px">
            <div style="background:#003da5;color:#fff;font-size:9px;font-weight:800;padding:0 5px;height:100%;display:flex;align-items:center;letter-spacing:.5px">NL</div>
            <div style="padding:0 14px;font-size:22px;font-weight:900;color:#000;font-family:var(--mono);letter-spacing:1px">${plate}</div>
          </div>
          ${v.vin?`<div style="font-size:9px;font-family:var(--mono);color:var(--text3);letter-spacing:.3px">VIN: ${v.vin}</div>`:''}
        </div>
        <div style="font-size:20px;font-weight:800;color:#fff;margin-top:10px;letter-spacing:-.3px">${v.make} ${v.model} ${v.generation||v.modelVariant||v.engineLabel||v.subModel||''}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:3px">${v.year} • ${N(km||v.km)} km • ${v.fuel||'—'}${v.transmissionType?' • '+v.transmissionType:''}${window._t4cCalc?.btw?' • BTW':' • Marge'}</div>
      </div>

      <!-- ═══ TURNTABLE PHOTO VIEWER (hoofdfoto) ═══ -->
      <div class="turntable-wrap" id="turntable-wrap">
        <div class="turntable" id="turntable">
          <div class="turntable-track" id="turntable-track">
            ${v.imageUrl?`<div class="turntable-slide"><img src="${v.imageUrl}" alt="${v.make} ${v.model}" onerror="this.parentElement.innerHTML='<div class=turntable-placeholder>🚗</div>'"></div>`:`<div class="turntable-slide"><div class="turntable-placeholder">🚗</div></div>`}
          </div>
          <div class="turntable-loading" id="turntable-loading">
            <div class="turntable-spinner"></div>
            <span>AI genereert foto's...</span>
          </div>
          <div class="turntable-dots" id="turntable-dots"></div>
          <div class="turntable-angle" id="turntable-angle"></div>
          <div class="turntable-hint" id="turntable-hint">↔ Veeg om te draaien</div>
        </div>
      </div>

      <!-- ═══ 360° SPINNER (if captured) ═══ -->
      <div id="spinner-360-wrap" style="display:none">
        <div style="font-size:10px;font-weight:700;color:var(--text4);text-transform:uppercase;letter-spacing:1px;padding:12px 16px 4px">360° Weergave</div>
        <div class="spinner-360" id="spinner-360-el"><div class="spinner-360-hint" id="spin-hint">↔ Sleep om te draaien</div></div>
      </div>
      <div id="damage-summary-wrap" style="display:none"></div>

      <!-- ═══ WARNINGS ═══ -->
      ${w?`<div style="padding:6px 12px"><div class="warns">${w}</div></div>`:''}
      ${risicoBadge?`<div style="padding:0 12px">${risicoBadge}</div>`:''}

      <!-- ═══ PRICING CARD ═══ -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin:8px 12px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:700;color:var(--text4);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">
          <span>Voorgesteld bod</span><span>Verkoopprijs</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div style="font-size:28px;font-weight:900;color:#f5a623;font-family:var(--mono);letter-spacing:-.5px" id="live-bod">${E(calc.bod)}</div>
          <div style="font-size:22px;font-weight:800;color:var(--text1);font-family:var(--mono)">${E(vp)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:10px">
          <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${E(r.inkoopLow||calc.bod*0.9)}</span>
          <div style="flex:1;height:6px;border-radius:3px;background:linear-gradient(90deg,#ef4444,#f59e0b,#22c55e);position:relative">
            <div style="position:absolute;top:-3px;left:${Math.min(95,Math.max(5,calc.margePct*1.5))}%;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid var(--bg);box-shadow:0 1px 4px rgba(0,0,0,.5);transform:translateX(-50%)"></div>
          </div>
          <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${E(r.inkoopHigh||calc.bod*1.1)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
          <div><div style="font-size:9px;font-weight:700;color:var(--text4);text-transform:uppercase;letter-spacing:.5px">Marge</div><div style="font-size:16px;font-weight:800;font-family:var(--mono);color:${calc.marge>2000?'var(--green)':calc.marge>0?'var(--orange)':'var(--red)'};margin-top:2px" id="live-marge">${E(calc.marge)}</div></div>
          <div><div style="font-size:9px;font-weight:700;color:var(--text4);text-transform:uppercase;letter-spacing:.5px">Handelswaarde</div><div style="font-size:16px;font-weight:800;font-family:var(--mono);color:var(--text1);margin-top:2px">${E(hw)}</div></div>
          <div><div style="font-size:9px;font-weight:700;color:var(--text4);text-transform:uppercase;letter-spacing:.5px">Marge %</div><div style="font-size:16px;font-weight:800;font-family:var(--mono);color:var(--text1);margin-top:2px" id="live-margepct">${calc.margePct}%</div></div>
        </div>
        <div style="text-align:center;margin-top:8px;font-size:9px;color:var(--text4)">(Gebaseerd op NL handelsdata, uitvoering, km-stand, opties en huidige marktprijzen)</div>
      </div>

      <!-- ═══ SCORES + BAROMETER ═══ -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin:8px 12px 0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:13px;font-weight:700;color:var(--text1);min-width:90px">Courantheid</span>
          <div style="flex:1;height:8px;border-radius:4px;overflow:hidden;background:var(--bg3)">
            <div style="height:100%;border-radius:4px;width:${courantScore*10}%;background:linear-gradient(90deg,${scBg(courantScore)},${scBg(courantScore)})"></div>
          </div>
          <span style="font-size:16px;font-weight:800;font-family:var(--mono);color:var(--green);min-width:32px;text-align:right">${courantScore.toFixed?courantScore.toFixed(1):courantScore}</span>
          <span style="font-size:13px;font-weight:700;font-family:var(--mono);color:#5ba0ff">${vergelijkScore.toFixed?vergelijkScore.toFixed(1):vergelijkScore}</span>
          <span style="font-size:11px;font-family:var(--mono);color:var(--text3)">+${courantBonusPct(initCourant).toFixed(1)}</span>
          <span style="font-size:11px;font-family:var(--mono);color:var(--green);font-weight:700">+${calc.courantBonus>0?E(calc.courantBonus):'0'}</span>
        </div>

        <!-- Barometer -->
        <div style="margin-top:4px">
          <div style="height:10px;border-radius:5px;background:linear-gradient(90deg,#ef4444 0%,#f59e0b 35%,#84cc16 65%,#22c55e 100%);position:relative">
            <div style="position:absolute;top:-4px;left:${baroPos}%;width:18px;height:18px;border-radius:50%;background:#fff;border:3px solid #222;transform:translateX(-50%);box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
            <span style="font-size:10px;color:var(--text3)">Niet kopen</span>
            <span style="font-size:18px;font-weight:900;color:var(--text1);font-family:var(--mono)">${margeScoreCalc.toFixed?margeScoreCalc.toFixed(1):margeScoreCalc}</span>
            <span style="font-size:10px;color:var(--text3)">Kopen</span>
          </div>
        </div>
      </div>

      <!-- ═══ VOERTUIGGEGEVENS ═══ -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);margin:8px 12px 0;padding:16px">
        <div style="font-size:18px;font-weight:800;color:var(--text1);margin-bottom:12px">Voertuiggegevens</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">✅</span><span style="font-size:13px;color:var(--text2)">Datum eerste toelating  <strong style="color:var(--text1)">${v.firstAdmission||v.registrationDateNL||v.year||'—'}</strong></span></div>
          <div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">${v.napOk!==false?'✅':'❌'}</span><span style="font-size:13px;color:var(--text2)">Kilometerstand  <strong style="color:var(--text1)">${N(km||v.km)} km</strong>  <span style="color:${v.napOk!==false?'var(--green)':'var(--red)'};font-size:12px">(${v.napOk!==false?'NAP gecontroleerd':'Geen NAP'})</span></span></div>
          <div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">✅</span><span style="font-size:13px;color:var(--text2)">Motor & transmissie  <strong style="color:var(--text1)">${v.fuel||'—'}, ${v.transmissionType||'—'}${v.transmissionDetail?' ('+v.transmissionDetail+')':''}${v.powerHp?', '+v.powerHp+' pk'+(v.powerKw?' / '+v.powerKw+' kW':''):''}</strong></span></div>
          ${v.timingType?`<div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">✅</span><span style="font-size:13px;color:var(--text2)"><strong style="color:var(--text1)">${v.timingType}</strong>${v.apkUntil?'  •  APK geldig tot <strong style="color:var(--text1)">'+v.apkUntil+'</strong>':''}</span></div>`:`${v.apkUntil?`<div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">✅</span><span style="font-size:13px;color:var(--text2)">APK geldig tot  <strong style="color:var(--text1)">${v.apkUntil}</strong></span></div>`:''}`}
        </div>
      </div>

      <!-- ═══ WAARDEN IN NEDERLAND ═══ -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);margin:8px 12px 0;padding:16px">
        <div style="font-size:18px;font-weight:800;color:var(--text1);margin-bottom:12px">Waarden in Nederland</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px">
          <div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">✅</span><span style="font-size:12px;color:var(--text2)">Handelswaarde <strong style="color:var(--text1)">${E(hw)}</strong></span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">${v.importFlag?'❌':'✅'}</span><span style="font-size:12px;color:var(--text2)">${v.importFlag?'Import voertuig':'Geen import'}</span></div>
          ${v.registrationDateNL?`<div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">✅</span><span style="font-size:12px;color:var(--text2)">NL auto sinds <strong style="color:var(--text1)">${v.registrationDateNL.substring?v.registrationDateNL.substring(0,4):v.year}</strong></span></div>`:'<div></div>'}
          ${v.ownerCount?`<div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">${v.ownerCount<=3?'✅':'⚠️'}</span><span style="font-size:12px;color:var(--text2)"><strong style="color:var(--text1)">${v.ownerCount}</strong> Eigenaar${v.ownerCount>1?'s':''}</span></div>`:'<div></div>'}
          ${v.catalogPrice?`<div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">✅</span><span style="font-size:12px;color:var(--text2)">Originele prijs <strong style="color:var(--text1)">${E(v.catalogPrice)}</strong></span></div>`:'<div></div>'}
          ${v.mrb?`<div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">✅</span><span style="font-size:12px;color:var(--text2)">MRB <strong style="color:var(--text1)">€${Math.round(v.mrb/12)}</strong>/maand</span></div>`:'<div></div>'}
          ${v.powerHp?`<div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">✅</span><span style="font-size:12px;color:var(--text2)">Vermogen <strong style="color:var(--text1)">${v.powerHp} pk${v.powerKw?' / '+v.powerKw+' kW':''}</strong></span></div>`:'<div></div>'}
          ${v.apkUntil?`<div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">✅</span><span style="font-size:12px;color:var(--text2)">APK geldig tot <strong style="color:var(--text1)">${v.apkUntil}</strong></span></div>`:'<div></div>'}
        </div>
      </div>

      <!-- ═══ SLIDERS — Aanpassing ═══ -->
      <div class="slider-section" style="margin:8px 12px 0">
        <div class="slider-section-title">🔧 Handmatige aanpassing</div>

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
        <div class="slider-section-title">${IC.tool} Onderhoudskosten</div>
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

      <!-- ═══ 6. AI INSIGHT ═══ -->
      ${(()=>{
        const ai=r.aiValidation;if(!ai||!ai.available)return '';
        let fl='';if(ai.riskFlags?.length)fl=ai.riskFlags.map(f=>'<span style="display:inline-block;padding:2px 6px;border-radius:6px;font-size:10px;background:var(--orange-dim,rgba(245,166,35,.1));color:var(--orange);margin:2px">'+f+'</span>').join('');
        return'<div style="background:var(--bg2);border:1px solid var(--border-l);border-radius:var(--radius);padding:10px 12px;margin-bottom:12px"><div style="font-size:11px;color:var(--text2);line-height:1.4">'+(ai.reasoning||'')+'</div>'+(ai.marketInsight?'<div style="font-size:10px;color:var(--text3);font-style:italic;margin-top:4px">'+ai.marketInsight+'</div>':'')+(fl?'<div style="margin-top:6px">'+fl+'</div>':'')+'</div>';
      })()}

      <!-- ═══ SUMMARY ═══ -->
      ${summary?`<div class="sum-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="font-size:14px;font-weight:700;color:var(--text1)">${r.courantLabel||'Marktanalyse'}</div>
          ${r.confidence?`<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${r.confidence>=70?'rgba(0,255,156,.1)':r.confidence>=50?'rgba(255,183,77,.1)':'rgba(255,77,77,.1)'};color:${r.confidence>=70?'var(--green)':r.confidence>=50?'var(--orange)':'var(--red)'};font-weight:600">${r.confidence}% vertrouwen</span>`:''}
        </div>
        <div class="sum-text">${summary}</div>
      </div>`:''}

      <!-- ═══ MARKET ═══ -->
      ${mktHtml}

      <!-- ═══ UITRUSTING / HIGHLIGHTS ═══ -->
      <div class="res-sec" style="margin:8px 12px 0">
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
        <button class="ract accent" onclick="showVoorraadModal()">
          Voorraad
        </button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="ract" style="flex:1" onclick="document.getElementById('vt-plate').value=fmtP('${last.plate.replace(/-/g,'')}');go('verkooptekst')">
          ${IC.pen} Verkooptekst genereren
        </button>
      </div>

      <!-- Voorraad modal -->
      <div id="voorraad-modal" style="display:none">
        <div style="background:var(--bg2);border:1px solid var(--border-l);border-radius:var(--radius);padding:16px;margin-top:12px">
          <div style="font-size:13px;font-weight:700;color:var(--text1);margin-bottom:10px">Toevoegen aan voorraad</div>
          <div class="tax-section-title">Vraagprijs</div>
          <div class="km-container" style="margin-bottom:12px"><input id="voorraad-prijs" class="km-input" type="number" style="font-size:18px" placeholder="${r.verkoopadviees||r.internetPrijs||'0'}"><span class="km-suf" style="right:16px">€</span></div>
          <div style="display:flex;gap:8px">
            <button class="act-btn" onclick="document.getElementById('voorraad-modal').style.display='none'" style="flex:1">Annuleer</button>
            <button class="act-btn primary" onclick="doAddVoorraad()" style="flex:1">Toevoegen</button>
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

