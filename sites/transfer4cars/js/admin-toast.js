/* T4C Admin Toast — 2026-06-11
 * Vervangt alert() in admin-pages. CarDataX-DNA (groen #00e68a / amber / red).
 * Gebruik: window.t4cToast("Klaar!", "ok") of window.t4cToast("Fout: ...", "err")
 * Kinds: ok (groen), warn (amber), err (rood)
 */
(function(){
  if (window.t4cToast) return; // al gedefinieerd

  function ensureRoot(){
    let r = document.getElementById("t4c-toast-root");
    if (r) return r;
    r = document.createElement("div");
    r.id = "t4c-toast-root";
    r.style.cssText = "position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;font-family:'Outfit',system-ui,sans-serif";
    document.body.appendChild(r);
    return r;
  }

  function colorFor(kind){
    if (kind === "err") return {bg:"#3b0a0a", border:"#ef4444", text:"#fecaca"};
    if (kind === "warn") return {bg:"#3b2a06", border:"#ffb300", text:"#fde68a"};
    return {bg:"#0a3b1f", border:"#00e68a", text:"#a7f3d0"}; // ok
  }

  window.t4cToast = function(msg, kind){
    const root = ensureRoot();
    const c = colorFor(kind || "ok");
    const el = document.createElement("div");
    el.style.cssText = "background:"+c.bg+";color:"+c.text+";border:1px solid "+c.border+";border-radius:8px;padding:12px 16px;min-width:220px;max-width:380px;box-shadow:0 4px 24px rgba(0,0,0,.4);font-size:14px;line-height:1.4;pointer-events:auto;transform:translateX(20px);opacity:0;transition:transform .2s,opacity .2s";
    el.textContent = msg;
    root.appendChild(el);
    // animate in
    requestAnimationFrame(()=>{ el.style.transform="translateX(0)"; el.style.opacity="1"; });
    // auto-dismiss
    const ttl = kind === "err" ? 6000 : 3500;
    setTimeout(()=>{
      el.style.transform = "translateX(20px)";
      el.style.opacity = "0";
      setTimeout(()=>el.remove(), 250);
    }, ttl);
    // click to dismiss
    el.addEventListener("click", ()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(),250); });
  };

  // Optioneel: confirm-modal (vervangt confirm() voor delete-flows)
  window.t4cConfirm = function(msg){
    return new Promise(resolve => {
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99998;display:flex;align-items:center;justify-content:center;font-family:'Outfit',system-ui,sans-serif";
      const box = document.createElement("div");
      box.style.cssText = "background:#0f1520;border:1px solid #00e68a;border-radius:12px;padding:24px;max-width:420px;color:#f0f4f8;box-shadow:0 8px 40px rgba(0,0,0,.6)";
      box.innerHTML = '<div style="font-size:15px;line-height:1.5;margin-bottom:18px">'+
        msg.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+
        '</div><div style="display:flex;gap:8px;justify-content:flex-end">'+
        '<button id="t4c-cf-no" style="background:transparent;color:#a8b8cc;border:1px solid #2d3a48;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px">Annuleren</button>'+
        '<button id="t4c-cf-yes" style="background:#00e68a;color:#001a0d;border:0;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;font-size:14px">Bevestig</button>'+
        '</div>';
      ov.appendChild(box);
      document.body.appendChild(ov);
      function cleanup(answer){ ov.remove(); resolve(answer); }
      ov.querySelector("#t4c-cf-no").onclick = ()=>cleanup(false);
      ov.querySelector("#t4c-cf-yes").onclick = ()=>cleanup(true);
      ov.addEventListener("click", e=>{ if(e.target===ov) cleanup(false); });
    });
  };
})();
