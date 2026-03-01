/* ═══════════════════════════════════════
   CarDatax Mobile — Taxatie (API call)
   ═══════════════════════════════════════ */
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
    // STAP 2+3: Marktdata + foto TEGELIJK ophalen (parallel!)
    const [mR, imgR] = await Promise.allSettled([
      fetch(`/api/market?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}&year=${v.year}&km=${km||0}&sub=${encodeURIComponent(v.subModel||'')}&body=${encodeURIComponent(v.body||'')}&fuel=${encodeURIComponent(v.fuel||'')}&transmission=${encodeURIComponent(v.transmissionAuto?'automaat':v.transmissionType?'handgeschakeld':'')}`).then(r=>r.json()),
      fetch('/api/image?make='+encodeURIComponent(v.make)+'&model='+encodeURIComponent(v.model)+'&year='+v.year+'&variant='+encodeURIComponent(v.modelVariant||'')+'&generation='+encodeURIComponent(v.generation||'')).then(r=>r.json()).catch(()=>null)
    ]);
    const m = mR.status==='fulfilled' ? mR.value : null;
    if(imgR.status==='fulfilled' && imgR.value?.url) v.imageUrl = imgR.value.url;

    ldStep(3);
    // STAP 4: Prijsberekening (heeft marktdata nodig)
    const pR=await fetch('/api/dealer/price',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({make:v.make,model:v.model,year:v.year,km:Number(km)||v.km||0,fuel:v.fuel,weightKg:v.weightKg,catalogPrice:v.catalogPrice,bpm:v.bpm,power:v.powerKw,marketAvg:m?.avg,marketMedian:m?.median,marketCount:m?.count,marketPrices:m?.prices,marketP10:m?.p10,marketP25:m?.p25,marketP75:m?.p75,marketP90:m?.p90,marketQuality:m?.validation?.quality,finnikAvailable:v.source?.finnik===true,finnikWaardeLow:v.finnikData?.waardeLow,finnikWaardeHigh:v.finnikData?.waardeHigh,ownerCount:v.ownerCount||0,isExDealer:v.isExDealer||false,bpmRest:v.bpmRest||0,bijtelling:v.bijtelling||null,emissieKlasse:v.emissieKlasse||null,importFlag:v.importFlag,stolenFlag:v.stolenFlag,transmissionAuto:v.transmissionAuto,transmissionType:v.transmissionType,transmissionDetail:v.transmissionDetail,equipmentLevel:v.equipmentLevel,engineLabel:v.engineLabel,subModel:v.subModel,vin:v.vin,motorCode:v.motorCode,generation:v.generation,trimLevel:v.trimLevel,drivetrain:v.drivetrain,interior:v.interior,optionPackage:v.optionPackage,engineRiskProfile:v.engineRiskProfile,courantScore:v.courantScore,optionPriceImpact:v.optionPriceImpact})});
    if(!pR.ok) throw new Error('Prijsberekening mislukt');
    const r=await pR.json();

    ldStep(4);
    last={v,m,r,plate:fmtP(p),km:Number(km)||0,damageCost:0,damageCount:0};
    recent=recent.filter(x=>x.plate!==last.plate);
    recent.unshift({plate:last.plate,make:v.make,model:v.model,year:v.year,bod:r.handelswaarde||r.t4cBod||((r.inkoopLow&&r.inkoopHigh)?Math.round((r.inkoopLow+r.inkoopHigh)/2):0),ts:Date.now()});
    if(recent.length>20)recent=recent.slice(0,20);
    try{localStorage.setItem('t4c_rec',JSON.stringify(recent))}catch{}

    // Auto-save (fire-and-forget — niet wachten)
    fetch('/api/taxatie/save',{method:'POST',headers:_authH(),body:JSON.stringify({kenteken:last.plate,make:v.make,model:v.model,year:v.year,fuel:v.fuel,km:last.km,power_kw:v.powerKw,power_hp:v.powerHp,engine_label:v.engineLabel,verkoopadviees:r.verkoopadviees,handelswaarde:r.handelswaarde,inkoop_low:r.inkoopLow,inkoop_high:r.inkoopHigh,internet_prijs:r.internetPrijs,market_count:m?.count,p25:m?.p25,p50:m?.median,p75:m?.p75,status:'concept'})}).catch(()=>{});

    render(); go('result');

    // ═══ AUTO-GENERATE CAR IMAGES (fire-and-forget, background) ═══
    generateCarImages(last);
  }catch(e){
    console.error('doTax error:', e);
    go('taxatie');
    if(errEl){errEl.textContent=e.message;errEl.style.display='block'}
    else toast(e.message,'error');
  }
}

