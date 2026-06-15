/* Transfer4Cars — theme toggle (dark/light)
   Reads/writes 't4c-theme' from localStorage and reflects it on <html data-theme>.
   Also injects a small toggle button at #theme-slot or appends to .head-in if no slot. */
(function(){
  var KEY = 't4c-theme';
  var html = document.documentElement;

  function apply(t){
    html.setAttribute('data-theme', t);
    try { localStorage.setItem(KEY, t); } catch(e) {}
    var btn = document.getElementById('themeBtn');
    if (btn) btn.innerHTML = iconFor(t);
  }
  function iconFor(t){
    return t === 'light'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
  window.toggleTheme = function(){
    var cur = html.getAttribute('data-theme') || 'dark';
    apply(cur === 'dark' ? 'light' : 'dark');
  };

  // Initial: localStorage > existing html attr > dark
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch(e) {}
  apply(saved || html.getAttribute('data-theme') || 'dark');

  // Auto-inject toggle button if page didn't include one
  function injectBtn(){
    if (document.getElementById('themeBtn')) return;
    var slot = document.getElementById('theme-slot');
    var target = slot || document.querySelector('.head-in, .t4c-header, header > div, header');
    if (!target) return;
    var b = document.createElement('button');
    b.id = 'themeBtn';
    b.className = 'theme-btn';
    b.setAttribute('aria-label','Wissel licht/donker');
    b.onclick = window.toggleTheme;
    b.innerHTML = iconFor(html.getAttribute('data-theme') || 'dark');
    b.style.cssText = 'width:32px;height:32px;border-radius:8px;border:1px solid var(--line-2,rgba(255,255,255,.18));background:transparent;color:var(--ink,#ecf0ed);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:.15s;margin-left:auto';
    // Place before .user/login area if present, else append
    var user = target.querySelector('.user, #user-area, .t4c-header__user');
    if (user) target.insertBefore(b, user);
    else target.appendChild(b);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBtn);
  } else { injectBtn(); }
})();
