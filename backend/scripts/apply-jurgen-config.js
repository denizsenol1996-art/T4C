// BRUG: jurgen-config.json -> gestagede engine-config. VEILIG: schrijft alleen in config/staging/,
// raakt NIETS live. Toepassen = apart (review + 662-gate). Vertaalt Jurgen's calibratie netjes:
// vaste kosten + marges + EV -> dealer-economics; per-model + risicomotoren -> bod-adjustments.
const fs=require('fs');
const B='/opt/t4c/backend', S=B+'/config/staging';
const cfgPath=process.argv[2]||B+'/config/jurgen-config.json';
if(!fs.existsSync(cfgPath)){console.log('GEEN jurgen-config.json op',cfgPath,'- niks te verwerken.');process.exit(0);}
const C=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
const filled=o=>o&&Object.keys(o).length>0;
const rep=[];
// 1) dealer-economics (vaste kosten + marges + EV + scherp/ruim) -> staged
const econ={bron:'jurgen-config',vaste_kosten:C.vaste_kosten||{},marges_per_prijsklasse:C.marges_per_prijsklasse||{},ev_regels:C.ev_regels||{},scherp_of_ruim:C.scherp_of_ruim||null};
fs.writeFileSync(S+'/dealer-economics.staged.json',JSON.stringify(econ,null,2));
rep.push('dealer-economics.staged.json  ('+(filled(C.vaste_kosten)?'vaste kosten OK':'vaste kosten leeg')+', '+(filled(C.marges_per_prijsklasse)?'marges OK':'marges leeg')+', '+(filled(C.ev_regels)?'EV OK':'EV leeg')+')');
// 2) bod-adjustments: bestaande + Jurgens per-model + risicomotoren -> staged
let adj={rules:[]};try{adj=JSON.parse(fs.readFileSync(B+'/config/bod-adjustments.json','utf8'));}catch(e){}
const list=Array.isArray(adj)?adj.slice():((adj.rules||adj.adjustments||[]).slice());
let added=0;
for(const bc of (C.bod_correcties||[])){
  if(bc.make&&bc.model&&bc.factor){list.push({id:'jurgen_'+(bc.make+'_'+bc.model).toLowerCase().replace(/\W+/g,'_'),make:String(bc.make).toUpperCase(),model:String(bc.model).toUpperCase(),factor:bc.factor,enabled:true,bron:'jurgen-calibratie'});added++;}
}
fs.writeFileSync(S+'/bod-adjustments.staged.json',JSON.stringify(Array.isArray(adj)?list:{...adj,rules:list},null,2));
rep.push('bod-adjustments.staged.json  ('+added+' nieuwe per-model correcties uit Jurgen)');
rep.push('risicomotoren extra: '+JSON.stringify(C.risicomotoren_extra||[]));
// 3) status
const segDone=Object.values(C.segment_status||{}).filter(Boolean).length;
const typDone=Object.values(C.taxatie_typen||{}).filter(Boolean).length;
console.log('=== BRUG: jurgen-config -> gestaged (NIKS LIVE) ===');
console.log('Calibratie-dekking: '+segDone+'/7 segmenten, '+typDone+'/4 taxatie-typen');
rep.forEach(r=>console.log('  - '+r));
console.log('Gestaged in: '+S);
console.log('VOLGENDE (apart, na review + 662-gate): engine-hook leest dealer-economics + cp staged->live + restart + meet accuracy_log.');
