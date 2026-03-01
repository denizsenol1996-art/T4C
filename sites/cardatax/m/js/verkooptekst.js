/* ═══════════════════════════════════════
   CarDatax Mobile — Verkooptekst Generator
   ═══════════════════════════════════════ */
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

