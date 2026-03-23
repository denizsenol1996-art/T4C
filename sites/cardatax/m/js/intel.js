// CarDatax Intelligence — trends, GPT validator, feedback
// Auto-generated from app refactor

function renderIntel(){
  var el=document.getElementById("intel-section");
  if(!el||!last||!last.intel)return;
  var i=last.intel, t=i.trend||{}, vel=i.velocity||{};
  var tIcon=t.direction==="stijgend"?"\u2197":t.direction==="dalend"?"\u2198":"\u2192";
  var tColor=t.direction==="stijgend"?"#00FF9C":t.direction==="dalend"?"#ef4444":"#8e94a8";
  var tBg=t.direction==="stijgend"?"rgba(0,255,156,.06)":t.direction==="dalend"?"rgba(239,68,68,.06)":"rgba(255,255,255,.03)";
  var velIcon=vel.velocity==="snel"?"\uD83D\uDD25":vel.velocity==="traag"?"\uD83D\uDC0C":"⚡";
  var conf=i.market_confidence==="hoog"?"\uD83D\uDFE2":i.market_confidence==="gemiddeld"?"\uD83D\uDFE1":"\uD83D\uDD34";
  var h='<div class="res-sec" style="border-color:'+tColor+'33">';
  h+='<div class="res-sec-head">Intelligence Engine</div>';
  h+='<div style="display:flex;gap:8px;margin-bottom:10px">';
  h+='<div style="flex:1;background:'+tBg+';border:1px solid '+tColor+'33;border-radius:10px;padding:12px;text-align:center">';
  h+='<div style="font-size:24px">'+tIcon+'</div>';
  h+='<div style="font-size:13px;font-weight:700;color:'+tColor+';margin-top:2px">'+(t.direction||"onbekend")+'</div>';
  h+='<div style="font-size:20px;font-weight:800;font-family:var(--mono);color:'+tColor+'">'+(t.change_pct>0?"+":"")+(t.change_pct||0)+'%</div>';
  h+='</div>';
  h+='<div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">';
  h+='<div style="font-size:24px">'+velIcon+'</div>';
  h+='<div style="font-size:13px;font-weight:700;color:var(--text1);margin-top:2px">Doorloop</div>';
  h+='<div style="font-size:14px;font-weight:600;color:var(--text2)">'+(vel.velocity||"onbekend")+'</div>';
  if(vel.avg_days)h+='<div style="font-size:10px;color:var(--text3);margin-top:2px">~'+vel.avg_days+' dagen</div>';
  h+='</div>';
  h+='<div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">';
  h+='<div style="font-size:24px">'+conf+'</div>';
  h+='<div style="font-size:13px;font-weight:700;color:var(--text1);margin-top:2px">Data</div>';
  h+='<div style="font-size:14px;font-weight:600;color:var(--text2)">'+(i.market_confidence||"onbekend")+'</div>';
  h+='<div style="font-size:10px;color:var(--text3);margin-top:2px">'+(i.data_points||0)+' snapshots</div>';
  h+='</div></div>';
  if(i.recommendation){
    h+='<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:13px;color:var(--text2);line-height:1.5">';
    h+='<span style="font-weight:700;color:var(--text1)">\uD83D\uDCA1 Advies:</span> '+i.recommendation+'</div>';
  }
  h+='</div>';
  el.innerHTML=h;
}

function fetchGptValidator(v, m, r, calc) {
  var el = document.getElementById("gpt-validator");
  if (!el) return;
  el.innerHTML = '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:16px;padding:16px;text-align:center;margin-bottom:12px"><div style="display:inline-block;width:18px;height:18px;border:2px solid var(--green);border-top-color:transparent;border-radius:50%;animation:sp .6s linear infinite"></div><div style="font-size:12px;color:var(--text3);margin-top:6px">AI analyseert je bod...</div></div>';
  
  var body = {
    make: v.make, model: v.model, year: v.year, km: last.km,
    fuel: v.fuel, powerHp: v.powerHp, engineLabel: v.engineLabel || "",
    transmission: v.transmissionType || "", subModel: v.subModel || "",
    trimLevel: v.trimLevel || "", engineRiskProfile: v.engineRiskProfile || "",
    ownerCount: v.ownerCount || 0, importFlag: v.importFlag || false,
    catalogPrice: v.catalogPrice || 0,
    ourBod: calc.bod, verkoopadviees: r.verkoopadviees || r.internetPrijs || 0,
    handelswaarde: r.handelswaarde || 0,
    inkoopLow: r.inkoopLow || 0, inkoopHigh: r.inkoopHigh || 0,
    marketMedian: m ? m.median : 0, marketP25: m ? m.p25 : 0,
    marketP75: m ? m.p75 : 0, marketCount: m ? m.count : 0
  };

  fetch("/api/taxatie/validate", {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": "Bearer " + localStorage.getItem("t4c_token")},
    body: JSON.stringify(body)
  }).then(function(r){ return r.json() }).then(function(d) {
    if (!d.ok) { el.innerHTML = ""; return; }
    renderGptValidator(el, d);
  }).catch(function() { el.innerHTML = ""; });
}

function renderGptValidator(el, d) {
  var vc = {
    "GOED_BOD": { icon: "\u2705", color: "#00FF9C", bg: "rgba(0,255,156,.06)", label: "Goed bod" },
    "TE_HOOG": { icon: "\u26A0\uFE0F", color: "#f59e0b", bg: "rgba(245,158,11,.06)", label: "Te hoog" },
    "TE_LAAG": { icon: "\uD83D\uDCC9", color: "#3b82f6", bg: "rgba(59,130,246,.06)", label: "Te laag" },
    "TOP_DEAL": { icon: "\uD83D\uDD25", color: "#00FF9C", bg: "rgba(0,255,156,.1)", label: "Top deal!" },
    "NIET_KOPEN": { icon: "\u274C", color: "#ef4444", bg: "rgba(239,68,68,.06)", label: "Niet kopen" }
  };
  var v = vc[d.verdict] || { icon: "\u2753", color: "#8e94a8", bg: "rgba(255,255,255,.03)", label: d.verdict };
  
  var h = '<div class="res-sec" style="border-color:' + v.color + '33;margin-bottom:12px">';
  h += '<div class="res-sec-head" style="display:flex;align-items:center;gap:8px">';
  h += '<span style="font-size:16px">\uD83E\uDDE0</span> AI Second Opinion';
  h += '<span style="margin-left:auto;font-size:10px;color:var(--text4)">CarDatax AI</span></div>';
  
  // Verdict banner
  h += '<div style="background:' + v.bg + ';border:1px solid ' + v.color + '33;border-radius:12px;padding:14px;margin-bottom:12px;display:flex;align-items:center;gap:12px">';
  h += '<div style="font-size:32px">' + v.icon + '</div>';
  h += '<div><div style="font-size:16px;font-weight:800;color:' + v.color + '">' + v.label + '</div>';
  h += '<div style="font-size:13px;color:var(--text2);margin-top:2px">' + (d.reasoning || "") + '</div></div></div>';
  
  // Price comparison
  h += '<div style="display:flex;gap:8px;margin-bottom:12px">';
  h += '<div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">';
  h += '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">AI Prijs</div>';
  h += '<div style="font-size:20px;font-weight:800;font-family:var(--mono);color:var(--green);margin-top:4px">\u20AC' + (d.gpt_price ? d.gpt_price.toLocaleString("nl-NL") : "?") + '</div></div>';
  h += '<div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">';
  h += '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Verkoopprijs</div>';
  h += '<div style="font-size:20px;font-weight:800;font-family:var(--mono);color:var(--text1);margin-top:4px">\u20AC' + (d.suggested_retail ? d.suggested_retail.toLocaleString("nl-NL") : "?") + '</div></div>';
  h += '<div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">';
  h += '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Marge</div>';
  h += '<div style="font-size:20px;font-weight:800;font-family:var(--mono);color:' + (d.margin_estimate > 1500 ? "var(--green)" : d.margin_estimate > 0 ? "var(--orange)" : "var(--red)") + ';margin-top:4px">\u20AC' + (d.margin_estimate ? d.margin_estimate.toLocaleString("nl-NL") : "?") + '</div></div>';
  h += '</div>';
  
  // Confidence bar
  var conf = Math.round((d.confidence || 0) * 100);
  h += '<div style="margin-bottom:12px">';
  h += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:4px"><span>AI Zekerheid</span><span style="color:var(--text1);font-weight:700">' + conf + '%</span></div>';
  h += '<div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + conf + '%;background:' + (conf > 70 ? "var(--green)" : conf > 40 ? "var(--orange)" : "var(--red)") + ';border-radius:3px"></div></div></div>';
  
  // Risk & Opportunities
  if ((d.risk_factors && d.risk_factors.length) || (d.opportunities && d.opportunities.length)) {
    h += '<div style="display:flex;gap:8px">';
    if (d.risk_factors && d.risk_factors.length) {
      h += '<div style="flex:1"><div style="font-size:10px;color:var(--red);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">\u26A0 Risico\'s</div>';
      d.risk_factors.forEach(function(r) { h += '<div style="font-size:12px;color:var(--text2);padding:3px 0">\u2022 ' + r + '</div>'; });
      h += '</div>';
    }
    if (d.opportunities && d.opportunities.length) {
      h += '<div style="flex:1"><div style="font-size:10px;color:var(--green);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">\u2713 Kansen</div>';
      d.opportunities.forEach(function(r) { h += '<div style="font-size:12px;color:var(--text2);padding:3px 0">\u2022 ' + r + '</div>'; });
      h += '</div>';
    }
    h += '</div>';
  }
  
  // Sell prediction
  var spIcon = d.sell_prediction === "snel" ? "\uD83D\uDD25" : d.sell_prediction === "traag" ? "\uD83D\uDC0C" : "\u26A1";
  h += '<div style="margin-top:10px;text-align:center;font-size:12px;color:var(--text3)">Verkoopverwachting: <span style="font-weight:700;color:var(--text1)">' + spIcon + ' ' + (d.sell_prediction || "onbekend") + '</span></div>';
  
  h += '</div>';
  el.innerHTML = h;
}

function showFeedbackModal() {
  if (!last) return;
  var overlay = document.createElement("div");
  overlay.id = "feedbackModal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:flex;align-items:flex-end;backdrop-filter:blur(4px)";
  overlay.innerHTML = '<div style="background:var(--bg2);border-radius:18px 18px 0 0;width:100%;max-height:70vh;padding:20px 16px calc(20px + var(--safe-b));border-top:1px solid var(--border-l)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
    '<div style="font-size:16px;font-weight:700;color:var(--text1)">Feedback: ' + last.plate + '</div>' +
    '<button onclick="document.getElementById(&quot;feedbackModal&quot;).remove()" style="background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer">&times;</button></div>' +
    '<div style="font-size:13px;color:var(--text2);margin-bottom:14px">' + (last.v.make||"") + " " + (last.v.model||"") + " " + (last.v.year||"") + '</div>' +
    '<div style="margin-bottom:12px"><div style="font-size:11px;font-weight:600;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Verkocht voor</div>' +
    '<input id="fb-price" type="number" placeholder="bijv. 12500" style="width:100%;background:var(--bg3);border:1.5px solid var(--border-l);border-radius:10px;padding:14px 16px;font-size:18px;color:var(--text1);font-family:var(--mono);outline:none;box-sizing:border-box"></div>' +
    '<div style="margin-bottom:12px"><div style="font-size:11px;font-weight:600;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Na hoeveel dagen</div>' +
    '<input id="fb-days" type="number" placeholder="bijv. 14" style="width:100%;background:var(--bg3);border:1.5px solid var(--border-l);border-radius:10px;padding:14px 16px;font-size:18px;color:var(--text1);font-family:var(--mono);outline:none;box-sizing:border-box"></div>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px">' +
    '<button onclick="submitFeedback(&quot;sold&quot;)" style="flex:1;padding:14px;background:var(--green);border:none;border-radius:12px;color:#000;font-size:14px;font-weight:700;cursor:pointer">Verkocht</button>' +
    '<button onclick="submitFeedback(&quot;not_sold&quot;)" style="flex:1;padding:14px;background:var(--bg3);border:1px solid var(--border-l);border-radius:12px;color:var(--text2);font-size:14px;font-weight:600;cursor:pointer">Niet verkocht</button>' +
    '<button onclick="submitFeedback(&quot;returned&quot;)" style="flex:1;padding:14px;background:var(--bg3);border:1px solid var(--border-l);border-radius:12px;color:var(--text2);font-size:14px;font-weight:600;cursor:pointer">Teruggegeven</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener("click", function(e) { if (e.target === overlay) overlay.remove(); });
}
function submitFeedback(type) {
  var price = document.getElementById("fb-price").value;
  var days = document.getElementById("fb-days").value;
  var body = {
    kenteken: last.plate, make: last.v.make, model: last.v.model, year: last.v.year,
    our_bod: window._t4cCalc ? window._t4cCalc.bodRaw : 0,
    sold_price: price ? Number(price) : null,
    days_on_lot: days ? Number(days) : null,
    feedback_type: type
  };
  fetch("/api/taxatie/feedback", {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": "Bearer " + localStorage.getItem("t4c_token")},
    body: JSON.stringify(body)
  }).then(function(r) { return r.json() }).then(function(d) {
    if (d.ok) { toast("Feedback opgeslagen — bedankt!", "success"); }
    else { toast("Fout: " + (d.error || "onbekend"), "error"); }
    var modal = document.getElementById("feedbackModal");
    if (modal) modal.remove();
  }).catch(function() { toast("Fout bij opslaan", "error"); });
}

// ═══ CONFIDENCE BADGE ═══
function fetchConfidence(v, r) {
  if (!v || !v.make) return;
  var hw = r ? (r.handelswaarde || 0) : 0;
  var url = '/api/intelligence/confidence/' + encodeURIComponent(v.make) + '/' + encodeURIComponent(v.model) + '/' + v.year + '?handelswaarde=' + hw;
  fetch(url, {headers: _authH()}).then(function(r){return r.json()}).then(function(d) {
    if (!d.ok) return;
    var el = document.getElementById('confidence-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'confidence-badge';
      var target = document.getElementById('intel-section') || document.getElementById('gpt-validator');
      if (target) target.parentNode.insertBefore(el, target);
    }
    
    var col = d.confidence_pct >= 80 ? 'var(--green)' : d.confidence_pct >= 50 ? '#f59e0b' : 'var(--red,#ef4444)';
    var h = '<div class="res-sec" style="margin-bottom:12px;border-color:' + col + '33">';
    h += '<div class="res-sec-head" style="display:flex;align-items:center;gap:8px">';
    h += '<span style="font-size:16px">\u2705</span> Betrouwbaarheid';
    h += '<span style="margin-left:auto;font-size:12px;font-weight:800;color:' + col + '">' + d.confidence_pct + '%</span></div>';
    
    // Confidence bar
    h += '<div style="height:4px;background:var(--bg);border-radius:2px;overflow:hidden;margin-bottom:12px"><div style="height:100%;width:' + d.confidence_pct + '%;background:' + col + ';border-radius:2px"></div></div>';
    
    // Label
    h += '<div style="font-size:13px;font-weight:600;color:' + col + ';margin-bottom:8px">' + (d.label || '') + '</div>';
    
    // Data points row
    h += '<div style="display:flex;gap:8px;margin-bottom:10px">';
    h += '<div style="flex:1;text-align:center;padding:8px;background:var(--bg3);border-radius:8px"><div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--text1)">' + (d.data_points || 0) + '</div><div style="font-size:9px;color:var(--text3);margin-top:2px">DATAPUNTEN</div></div>';
    h += '<div style="flex:1;text-align:center;padding:8px;background:var(--bg3);border-radius:8px"><div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--text1)">' + (d.active_listings || 0) + '</div><div style="font-size:9px;color:var(--text3);margin-top:2px">LISTINGS</div></div>';
    h += '<div style="flex:1;text-align:center;padding:8px;background:var(--bg3);border-radius:8px"><div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--text1)">' + (d.sold_references || 0) + '</div><div style="font-size:9px;color:var(--text3);margin-top:2px">VERKOCHT</div></div>';
    h += '</div>';
    
    // Triple validation
    if (d.systems) {
      h += '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Gevalideerd door</div>';
      d.systems.forEach(function(s) {
        var ic = s.status === 'actief' ? '\u2713' : s.status === 'beperkt' ? '\u25CB' : '\u2717';
        var sc = s.status === 'actief' ? 'var(--green)' : s.status === 'beperkt' ? '#f59e0b' : 'var(--text3)';
        h += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px"><span style="color:' + sc + ';font-weight:700">' + ic + '</span><span style="color:var(--text2)">' + s.name + '</span>';
        if (s.points) h += '<span style="margin-left:auto;font-size:10px;color:var(--text3);font-family:var(--mono)">' + s.points + '</span>';
        h += '</div>';
      });
    }
    
    h += '</div>';
    el.innerHTML = h;
  }).catch(function(){});
}
