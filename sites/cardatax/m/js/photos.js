/* ═══════════════════════════════════════
   CarDatax Mobile — Photos & Turntable
   ═══════════════════════════════════════ */
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
      const r=await fetch('/api/voorraad/'+plate+'/photos',{method:'POST',headers:_authH(),body:JSON.stringify({image:b64,filename:f.name})});
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
  // Fallback: use whatever order we got
  const imgs=sorted.length>=3?sorted:images.filter(i=>i.url);
  if(!imgs.length) return;

  if(loading) loading.style.display='none';

  // Build slides
  const ts=Date.now();
  track.innerHTML=imgs.map(img=>`<div class="turntable-slide"><img src="${img.url}?t=${ts}" alt="${labels[img.angle]||''}" onerror="this.parentElement.innerHTML='<div class=turntable-placeholder>🚗</div>'"></div>`).join('');

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
    cur=((i%total)+total)%total; // wrap around for turntable feel
    track.style.transform=`translateX(-${cur*100}%)`;
    document.querySelectorAll('.turntable-dot').forEach((d,j)=>d.classList.toggle('active',j===cur));
    if(angleLabel) angleLabel.textContent=labels[imgs[cur].angle]||'';
  }

  // Touch
  track.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;dx=0;swiping=true;track.style.transition='none'},{passive:true});
  track.addEventListener('touchmove',e=>{
    if(!swiping) return;
    dx=e.touches[0].clientX-sx;
    // Live drag feedback
    const offset=-cur*100+(dx/track.parentElement.offsetWidth)*100;
    track.style.transform=`translateX(${offset}%)`;
  },{passive:true});
  track.addEventListener('touchend',()=>{
    if(!swiping) return;
    swiping=false;
    track.style.transition='transform .3s cubic-bezier(.25,.46,.45,.94)';
    if(Math.abs(dx)>40){goTo(dx<0?cur+1:cur-1)}else{goTo(cur)}
  });

  // Mouse drag
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

  // Dot clicks
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
