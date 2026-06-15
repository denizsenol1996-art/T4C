#!/usr/bin/env node
/* T4C COCKPIT — read-only visueel dashboard voor de hele t4c-constellatie.
 * Zero dependencies (puur Node http). Doet NIETS schrijven: alleen lezen + t4c-state.sh draaien.
 * Start: COCKPIT_PASS=... node server.js   (luistert op 127.0.0.1:3300)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.COCKPIT_PORT || 3300;
const HOST = '127.0.0.1';
const PASS = process.env.COCKPIT_PASS || 't4c-cockpit-2026';
const USER = 'Admin';

// Toegestane wortels om in te bladeren (read-only)
const ROOTS = {
  t4c: '/opt/t4c',
  'atx-pipeline': '/opt/atx-pipeline',
  cardatax: '/opt/cardatax',
  'cardatax-app': '/opt/cardatax-app',
  lyra: '/opt/lyra',
};
const ROOT_PATHS = Object.values(ROOTS);
const STATE_SCRIPT = '/opt/t4c/scripts/t4c-state.sh';
const MAP_FILE = '/opt/t4c/docs/00-SYSTEEMKAART-T4C.md';
const SKIP_DIRS = new Set(['node_modules', '.git', 'backups', 'data', 'FULL-STATE-BACKUPS', 'photos']);
const MAX_FILE = 2 * 1024 * 1024; // 2MB leescap

function auth(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, p] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  return u === USER && p === PASS;
}
function safeResolve(p) {
  if (!p) return null;
  const real = path.resolve(p);
  if (!ROOT_PATHS.some(r => real === r || real.startsWith(r + path.sep))) return null;
  return real;
}
function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (!auth(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="T4C Cockpit"' });
    return res.end('Auth vereist');
  }
  const u = new URL(req.url, `http://${HOST}`);

  // --- API: live staat ---
  if (u.pathname === '/api/state') {
    execFile('bash', [STATE_SCRIPT], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, out, errout) => {
      json(res, { ok: !err, output: (out || '') + (errout || '') + (err ? `\n[exit] ${err.message}` : '') });
    });
    return;
  }
  // --- API: directory tree ---
  if (u.pathname === '/api/tree') {
    const dir = safeResolve(u.searchParams.get('path') || ROOTS.t4c);
    if (!dir) return json(res, { error: 'pad niet toegestaan' }, 403);
    fs.readdir(dir, { withFileTypes: true }, (err, items) => {
      if (err) return json(res, { error: err.message }, 500);
      const entries = items
        .filter(d => !d.name.startsWith('.git') )
        .map(d => {
          const full = path.join(dir, d.name);
          let size = 0; try { size = d.isFile() ? fs.statSync(full).size : 0; } catch (e) {}
          return { name: d.name, dir: d.isDirectory(), path: full, size, skip: SKIP_DIRS.has(d.name) };
        })
        .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
      json(res, { path: dir, parent: dir === ROOT_PATHS.find(r => dir.startsWith(r)) ? null : path.dirname(dir), entries });
    });
    return;
  }
  // --- API: file inhoud (read-only) ---
  if (u.pathname === '/api/file') {
    const f = safeResolve(u.searchParams.get('path'));
    if (!f) return json(res, { error: 'pad niet toegestaan' }, 403);
    fs.stat(f, (err, st) => {
      if (err || !st.isFile()) return json(res, { error: 'geen bestand' }, 404);
      if (st.size > MAX_FILE) return json(res, { error: `te groot (${(st.size/1048576).toFixed(1)}MB)`, size: st.size }, 413);
      fs.readFile(f, 'utf8', (e, data) => e ? json(res, { error: 'binair of onleesbaar' }, 415) : json(res, { path: f, size: st.size, content: data }));
    });
    return;
  }
  // --- API: systeemkaart ---
  if (u.pathname === '/api/map') {
    fs.readFile(MAP_FILE, 'utf8', (e, data) => json(res, { ok: !e, content: e ? `Kaart niet gevonden: ${MAP_FILE}` : data }));
    return;
  }
  // --- API: roots ---
  if (u.pathname === '/api/roots') return json(res, { roots: ROOTS });
  // --- API: accuratesse (proxy naar t4c leerlus) ---
  if (u.pathname === '/api/accuracy') {
    http.get('http://127.0.0.1:3000/api/groundtruth/stats', r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(d); });
    }).on('error', e => json(res, { error: e.message }, 502));
    return;
  }

  // --- HTML ---
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});
server.listen(PORT, HOST, () => console.log(`T4C Cockpit op http://${HOST}:${PORT}`));

const HTML = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>T4C Cockpit</title><style>
:root{--bg:#0b0f14;--panel:#121823;--line:#1e2a3a;--txt:#cdd9e5;--dim:#7d8da0;--acc:#3ea6ff;--ok:#39d98a;--warn:#ffb454;--bad:#ff5c5c}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--bg);color:var(--txt)}
header{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--panel)}
header h1{font-size:15px;margin:0;letter-spacing:.5px}header .dot{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)}
nav{display:flex;gap:6px;margin-left:auto}nav button{background:#0e1622;color:var(--dim);border:1px solid var(--line);padding:7px 14px;border-radius:7px;cursor:pointer}
nav button.on{color:#fff;border-color:var(--acc);background:#10233a}
main{padding:16px 18px}.tab{display:none}.tab.on{display:block}
pre{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;white-space:pre-wrap;max-height:78vh}
.row{display:flex;gap:16px;align-items:flex-start}.col-tree{width:42%;min-width:280px}.col-view{flex:1;min-width:0}
.crumb{color:var(--dim);font-size:12px;margin:4px 0 10px;word-break:break-all}
.list{background:var(--panel);border:1px solid var(--line);border-radius:8px;max-height:78vh;overflow:auto}
.item{display:flex;justify-content:space-between;gap:8px;padding:6px 12px;cursor:pointer;border-bottom:1px solid #15202e}
.item:hover{background:#16202e}.item .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item.d .nm{color:var(--acc)}.item.skip .nm{color:var(--dim)}.sz{color:var(--dim);font-size:11px;flex:none}
.btn{background:#10233a;color:var(--acc);border:1px solid var(--acc);padding:6px 12px;border-radius:7px;cursor:pointer;font:inherit}
.muted{color:var(--dim)}.k{color:var(--warn)}h2,h3{color:#fff}.map h1{color:var(--acc);font-size:18px}.map h2{font-size:15px;border-top:1px solid var(--line);padding-top:10px}
.chip{display:inline-block;padding:1px 7px;border-radius:5px;font-size:11px;border:1px solid var(--line)}
</style></head><body>
<header><span class="dot"></span><h1>T4C COCKPIT <span class="muted">— read-only</span></h1>
<nav><button data-t="state" class="on">⚡ Live staat</button><button data-t="acc">📈 Accuratesse</button><button data-t="files">📂 Bestanden</button><button data-t="map">🗺️ Systeemkaart</button></nav></header>
<main>
 <section id="state" class="tab on"><div style="margin-bottom:10px"><button class="btn" onclick="loadState()">↻ Vernieuw live staat</button> <span class="muted" id="stMeta"></span></div><pre id="stOut">laden…</pre></section>
 <section id="acc" class="tab"><div style="margin-bottom:10px"><button class="btn" onclick="loadAcc()">↻ Vernieuw accuratesse</button></div><div id="accOut" class="muted">laden…</div></section>
 <section id="files" class="tab"><div id="rootsBar" style="margin-bottom:10px"></div><div class="row">
   <div class="col-tree"><div class="crumb" id="crumb"></div><div class="list" id="tree"></div></div>
   <div class="col-view"><div class="crumb" id="fcrumb">selecteer een bestand</div><pre id="fileOut" class="muted">—</pre></div>
 </div></section>
 <section id="map" class="tab"><div class="map" id="mapOut">laden…</div></section>
</main>
<script>
const $=s=>document.querySelector(s);
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));$('#'+b.dataset.t).classList.add('on');
  if(b.dataset.t==='map'&&!$('#mapOut').dataset.l)loadMap();
  if(b.dataset.t==='files'&&!$('#tree').dataset.l)initFiles();
  if(b.dataset.t==='acc'&&!$('#accOut').dataset.l)loadAcc();
});
async function loadAcc(){$('#accOut').dataset.l=1;$('#accOut').textContent='laden…';
  const r=await fetch('/api/accuracy').then(r=>r.json()).catch(e=>({error:String(e)}));
  if(r.error){$('#accOut').className='';$('#accOut').textContent='⚠️ '+r.error;return;}
  const card=(label,val,suffix,good)=>'<div style="background:var(--panel);border:1px solid var(--line);border-left:3px solid '+good+';border-radius:8px;padding:14px 16px;min-width:150px"><div class="muted" style="font-size:12px">'+label+'</div><div style="font-size:24px;color:#fff;margin-top:4px">'+val+'<span class="muted" style="font-size:13px">'+(suffix||'')+'</span></div></div>';
  $('#accOut').className='';
  $('#accOut').innerHTML='<div class="muted" style="margin-bottom:10px">Bron: '+r.bron+' — '+r.n+' echte uitkomsten · gekoppeld kenteken '+r.gekoppeld_kenteken+'</div>'+
    '<div style="display:flex;gap:12px;flex-wrap:wrap">'+
    card('Binnen 5%',r.binnen_5pct,'%','var(--acc)')+
    card('Binnen 10%',r.binnen_10pct,'%','var(--acc)')+
    card('Mediaan fout',r.mediaan_fout_pct,'%','var(--warn)')+
    card('Bias (bod te hoog)','+'+r.bias_pct,'%','var(--warn)')+
    card('Going-forward resolved',r.accuracy_log_resolved,'','var(--ok)')+
    '</div><div class="muted" style="margin-top:14px;max-width:680px">Bias +'+r.bias_pct+'% = bod gemiddeld te hoog (over-bidding). Mediaan fout '+r.mediaan_fout_pct+'% = helft van de bods zit binnen die marge. "Resolved" groeit zodra nieuwe taxaties een echte uitkomst krijgen via de leer-lus.</div>';}
async function loadState(){$('#stOut').textContent='laden…';const r=await fetch('/api/state').then(r=>r.json());
  $('#stOut').textContent=r.output||'(leeg)';$('#stMeta').textContent='bijgewerkt '+new Date().toLocaleTimeString();}
loadState();
let ROOTS={};
async function initFiles(){const r=await fetch('/api/roots').then(r=>r.json());ROOTS=r.roots;
  $('#rootsBar').innerHTML=Object.entries(ROOTS).map(([k,v])=>'<span class="btn" style="margin-right:6px" onclick="openDir(\\''+v+'\\')">'+k+'</span>').join('');
  $('#tree').dataset.l=1;openDir(ROOTS.t4c);}
async function openDir(p){const r=await fetch('/api/tree?path='+encodeURIComponent(p)).then(r=>r.json());
  if(r.error){$('#tree').innerHTML='<div class="item">'+r.error+'</div>';return;}
  $('#crumb').textContent=r.path;let h='';
  if(r.parent)h+='<div class="item d" onclick="openDir(\\''+r.parent+'\\')"><span class="nm">⬑ ..</span></div>';
  for(const e of r.entries){const cls='item'+(e.dir?' d':'')+(e.skip?' skip':'');
    const act=e.dir?(e.skip?'':'openDir(\\''+e.path+'\\')'):'openFile(\\''+e.path+'\\')';
    const sz=e.dir?(e.skip?'<span class="sz">overgeslagen</span>':''):'<span class="sz">'+fmt(e.size)+'</span>';
    h+='<div class="'+cls+'" onclick="'+act+'"><span class="nm">'+(e.dir?'📁 ':'📄 ')+e.name+'</span>'+sz+'</div>';}
  $('#tree').innerHTML=h;}
async function openFile(p){$('#fcrumb').textContent=p;$('#fileOut').textContent='laden…';$('#fileOut').className='';
  const r=await fetch('/api/file?path='+encodeURIComponent(p)).then(r=>r.json());
  $('#fileOut').textContent=r.error?('⚠️ '+r.error):r.content;}
function fmt(b){if(!b)return'';if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(0)+' KB';return(b/1048576).toFixed(1)+' MB';}
async function loadMap(){const r=await fetch('/api/map').then(r=>r.json());$('#mapOut').dataset.l=1;$('#mapOut').innerHTML=md(r.content);}
function md(t){return t.split('\\n').map(l=>{
  if(/^#{4}/.test(l))return'<h4>'+esc(l.replace(/^#+\\s*/,''))+'</h4>';
  if(/^###/.test(l))return'<h3>'+esc(l.replace(/^#+\\s*/,''))+'</h3>';
  if(/^##/.test(l))return'<h2>'+esc(l.replace(/^#+\\s*/,''))+'</h2>';
  if(/^#/.test(l))return'<h1>'+esc(l.replace(/^#+\\s*/,''))+'</h1>';
  if(/^═|^─/.test(l))return'<hr style="border-color:#1e2a3a">';
  if(/^[-*] /.test(l))return'<div>• '+ib(l.slice(2))+'</div>';
  if(l.trim()==='')return'<br>';return'<div>'+ib(l)+'</div>';}).join('');}
function ib(s){return esc(s).replace(/\`([^\`]+)\`/g,'<span class="k">$1</span>').replace(/\\*\\*([^*]+)\\*\\*/g,'<b style="color:#fff">$1</b>');}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
</script></body></html>`;
