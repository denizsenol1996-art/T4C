/* T4C Unified User-Nav — 2026-06-11
 * Eén shared dropdown over alle klant-pages. Role-aware (klant/staff/admin).
 * Vervangt inline ua.innerHTML=... blokken op /veilingen/, /aanbod/, /account/,
 * /transport/, /verkoop/, /login/, /aanmelden/, /auto/ + updateNav() op /.
 *
 * Gebruik:  t4cUserNav("user-area", { currentPath: location.pathname, extraCta: '<a class="cta" href="/admin/#nieuw">+ Nieuwe veiling</a>' })
 * Returns:  { user, role, isStaff, isLoggedIn }
 *
 * Logout: localStorage.clear + reload (consistent met huidige flow op /veilingen/)
 */
(function(){
  if (window.t4cUserNav) return;

  // ── Read state from localStorage ─────────────────────────────
  function getState(){
    let user = {};
    try { user = JSON.parse(localStorage.getItem("t4c_user") || "{}") } catch {}
    const token = localStorage.getItem("t4c_token") || "";
    const role = user?.role || "";
    const isStaff = ["admin","staff","t4c","inkoper"].includes(role);
    const isLoggedIn = !!(token && user?.username);
    return { user, token, role, isStaff, isLoggedIn };
  }

  // ── Canonieke menu-items per rol (single source of truth) ───
  // Wijziging hier = alle pages updaten tegelijk. Geen duplicate-spaghetti meer.
  const KLANT_ITEMS = [
    { label: "Mijn account",   href: "/account/" },
    { label: "Veilingen",      href: "/veilingen/" },
    { label: "Voorraad",       href: "/aanbod/" },
    { label: "Transport",      href: "/transport/" },
  ];
  const STAFF_ITEMS = [
    { label: "Veilingen-beheer",    href: "/admin/" },
    { label: "Inbox",                href: "/admin/inbox/" },
    { label: "Transport-planner",    href: "/admin/transport/" },
    { label: "Analytics",            href: "/admin/analytics/" },
    { label: "Taxatie-rapporten",    href: "/telex-inkoop/" },
    { label: "Command Center",        href: "/admin/klassiek/" },
    { label: "CarDatax Pricing",     href: "/app/" },
    { divider: true },
    { label: "Mijn profiel",         href: "/account/" },
    { label: "Naar publieke site",   href: "/" },
  ];

  function esc(s){ return String(s||"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  // ── Style helpers (use CSS-vars wanneer aanwezig, anders fallback) ──
  const linkStyle = "display:block;padding:9px 13px;color:var(--text2,#a8b8cc);border-radius:8px;font-size:13px;text-decoration:none;white-space:nowrap";
  const divStyle = "border-top:1px solid var(--border,rgba(255,255,255,.08));margin:4px 0";
  const ddStyle = "display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--bg2,#0f1520);border:1px solid var(--border2,rgba(255,255,255,.12));border-radius:12px;padding:8px;min-width:220px;z-index:300;box-shadow:0 8px 32px rgba(0,0,0,.4)";

  function buildItems(items, currentPath){
    return items.map(it => {
      if (it.divider) return '<div style="'+divStyle+'"></div>';
      const isActive = currentPath && (it.href === currentPath || (it.href !== "/" && currentPath.startsWith(it.href)));
      const activeStyle = isActive ? ";background:var(--green-dim,rgba(0,230,138,.08));color:var(--green,#00e68a)" : "";
      return '<a href="'+it.href+'" style="'+linkStyle+activeStyle+'">'+esc(it.label)+'</a>';
    }).join("");
  }

  // ── Render functie ─────────────────────────────────────────
  // Defensive auto-init: als er een #user-area element bestaat maar de inline-script
  // (die normaal t4cUserNav aanroept) crasht of ontbreekt, render alsnog op DOMContentLoaded.
  // Voorkomt dat een bug ELDERS in een page tot lege user-area leidt.
  function autoInit(){
    const el = document.getElementById("user-area");
    if (!el || el.dataset.t4cInited === "1") return;
    el.dataset.t4cInited = "1";
    window.t4cUserNav("user-area", { currentPath: location.pathname });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    setTimeout(autoInit, 0);
  }

  window.t4cUserNav = function(elementId, options){
    options = options || {};
    const el = document.getElementById(elementId);
    if (!el) return getState();
    // Mark dat handmatige aanroep gebeurd is — autoInit slaat 'm dan over
    el.dataset.t4cInited = "1";
    const st = getState();
    const currentPath = options.currentPath || location.pathname;
    const extraCta = options.extraCta || "";

    if (!st.isLoggedIn) {
      const nextParam = currentPath && currentPath !== "/login/" ? ("?next=" + encodeURIComponent(currentPath)) : "";
      el.innerHTML =
        '<a class="linkbtn" href="/login/'+nextParam+'" style="padding:8px 14px;color:var(--text2,#a8b8cc);text-decoration:none;font-size:13px">Inloggen</a>'+
        '<a class="cta" href="/aanmelden/" style="padding:9px 18px;background:var(--green,#00e68a);color:#001a0d;border-radius:8px;font-weight:600;text-decoration:none;font-size:13px;margin-left:8px">Aanvragen</a>';
      return st;
    }

    const items = st.isStaff ? STAFF_ITEMS : KLANT_ITEMS;
    const itemsHtml = buildItems(items, currentPath);
    const logoutItem = '<div style="'+divStyle+'"></div><a href="#" data-t4c-logout="1" style="'+linkStyle+';color:#ef4444">Uitloggen</a>';

    // Mark + dropdown
    const displayName = st.user?.name || st.user?.username || "Account";
    el.style.position = "relative";
    el.innerHTML =
      extraCta+
      '<button type="button" id="t4cUserBtn" style="background:transparent;border:0;padding:8px 12px;color:var(--text1,#f0f4f8);cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;display:inline-flex;align-items:center;gap:4px">'+
        esc(displayName)+' <span style="font-size:9px;opacity:.6">▾</span>'+
      '</button>'+
      '<div id="t4cUserDd" style="'+ddStyle+'">'+itemsHtml+logoutItem+'</div>';

    const btn = el.querySelector("#t4cUserBtn");
    const dd = el.querySelector("#t4cUserDd");

    btn.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      dd.style.display = dd.style.display === "block" ? "none" : "block";
    });

    // Close on outside click
    document.addEventListener("click", e => {
      if (!el.contains(e.target)) dd.style.display = "none";
    });

    // Logout handler
    el.querySelector("[data-t4c-logout]").addEventListener("click", e => {
      e.preventDefault();
      // Best-effort server-side revoke (van SEC-4)
      try {
        fetch("/api/logout", { method: "POST", headers: { "Authorization": "Bearer " + (localStorage.getItem("t4c_token")||"") }, keepalive: true });
      } catch {}
      localStorage.removeItem("t4c_token");
      localStorage.removeItem("t4c_user");
      location.href = "/";
    });

    return st;
  };
})();
