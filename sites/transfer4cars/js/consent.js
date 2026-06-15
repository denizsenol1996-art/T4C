/* Transfer4Cars — cookie consent (Google Consent Mode v2)
   Default: all storage denied. After user accepts, granted state is pushed.
   Stores choice in localStorage 't4c_consent' ∈ {granted,denied}. */
(function(){
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  // Default consent — must run BEFORE gtag('config', ...) loads
  gtag('consent', 'default', {
    ad_storage:'denied',
    ad_user_data:'denied',
    ad_personalization:'denied',
    analytics_storage:'denied',
    functionality_storage:'granted',
    security_storage:'granted',
    wait_for_update:500
  });

  var KEY = 't4c_consent';
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch(e) {}
  if (saved === 'granted') {
    gtag('consent','update',{
      ad_storage:'granted', ad_user_data:'granted',
      ad_personalization:'granted', analytics_storage:'granted'
    });
    return;
  }
  if (saved === 'denied') return;

  // No choice yet → render banner once DOM is ready
  function render(){
    if (document.getElementById('t4c-cc')) return;
    var css = '#t4c-cc{position:fixed;left:16px;right:16px;bottom:16px;max-width:820px;margin:0 auto;'
      + 'background:#0f181d;color:#ecf0ed;border:1px solid rgba(255,255,255,.12);border-radius:14px;'
      + 'padding:22px 26px;box-shadow:0 18px 50px rgba(0,0,0,.5);z-index:9999;'
      + 'font-family:Outfit,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;font-size:14px;line-height:1.55}'
      + '#t4c-cc p{margin:0 0 14px;color:#cbd5d1}'
      + '#t4c-cc a{color:#00e68a;text-decoration:underline}'
      + '#t4c-cc .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;justify-content:flex-end}'
      + '#t4c-cc button{font-family:inherit;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;'
      + 'border:1px solid #00e68a;background:#00e68a;color:#001a0d;cursor:pointer;transition:.15s}'
      + '#t4c-cc button:hover{background:#0fff97;border-color:#0fff97}'
      + '@media(max-width:480px){#t4c-cc{left:8px;right:8px;bottom:8px;padding:18px}#t4c-cc .row{justify-content:stretch}#t4c-cc button{flex:1}}';
    var st = document.createElement('style'); st.appendChild(document.createTextNode(css)); document.head.appendChild(st);

    var box = document.createElement('div');
    box.id = 't4c-cc';
    box.setAttribute('role','dialog');
    box.setAttribute('aria-label','Cookietoestemming');
    box.innerHTML =
      '<p><strong style="color:#fff">Cookies &amp; voorwaarden</strong> — '
      + 'om Transfer4Cars te gebruiken vragen we je akkoord met onze '
      + '<a href="/voorwaarden/" target="_blank" rel="noopener">algemene voorwaarden</a>, '
      + '<a href="/privacy/" target="_blank" rel="noopener">privacyverklaring</a> '
      + 'en het gebruik van functionele en analytische cookies (Google Analytics) waarmee we de site verbeteren.</p>'
      + '<div class="row">'
      + '  <button id="t4c-cc-acc">Akkoord &amp; doorgaan</button>'
      + '</div>';
    document.body.appendChild(box);

    function close(choice){
      try { localStorage.setItem(KEY, choice); } catch(e) {}
      gtag('consent','update',{
        ad_storage:'granted', ad_user_data:'granted',
        ad_personalization:'granted', analytics_storage:'granted'
      });
      box.remove();
    }
    document.getElementById('t4c-cc-acc').onclick = function(){ close('granted'); };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else { render(); }

  // Allow user to re-open later: any <a href="#cookies"> click reopens banner
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href="#cookies"]');
    if (!a) return;
    e.preventDefault();
    try { localStorage.removeItem(KEY); } catch(_) {}
    if (!document.getElementById('t4c-cc')) render();
  });
})();
