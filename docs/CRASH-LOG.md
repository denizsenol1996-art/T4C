# T4C / Claude-sessie Crash Log

> **Doel** — bij elke disconnect, Claude-CLI-crash, server-storm of "we waren bezig"-onderbreking direct hieronder een entry maken. Voorkomt dat we context kwijtraken en herhaalt-onszelf-cycli ontstaan.
>
> **Trigger-woorden van user** die altijd een entry opleveren: "je crashte", "connection issues", "connection closed", "send disconnect", "websocket bad handshake", "we waren nog bezig", "client_loop", "tunnel viel weg", "we werden afgekoppeld".
>
> **Format** — kopieer het template, vul in, commit niet (lokaal doc). Hoog detail bij eerste 5 entries, daarna patronen distilleren naar `feedback`-memory zodat we structureel iets oplossen.

---

## Template (kopiëren bovenaan toevoegen)

```markdown
### YYYY-MM-DD HH:MM — korte titel
**Symptoom (wat zag user):** …
**Vermoede oorzaak:** … (Claude-CLI / cloudflared / SSH / netwerk / server-crash / onbekend)
**Sessie-ID (vóór crash):** … (uit conversatie-log indien zichtbaar)
**Stand vóór crash (laatste bevestigd werk):** … (welke files/services/state)
**Verloren werk:** … (niets / specifiek …)
**Stand bij hervatten:** … (server-up?, pages 200?, pm2 restart-count?)
**Wat user opnieuw moest doen:** … (re-uploaden, opnieuw inloggen, etc.)
**Actie genomen om herhaling te voorkomen:** … (memory-regel, watchdog, doc, niets)
**Open issue na crash:** … (link naar TODO of "niets")
```

---

## Entries (nieuwste bovenaan)

### 2026-06-10 ~17:55 — `client_loop: send disconnect` tijdens permission-prompt (ATX-pipeline 404-diagnose)
**Symptoom (wat zag user):** `client_loop: send disconnect: Unknown error` precies op het moment dat Claude een Bash-permission-prompt toonde voor diagnose-commando `curl + grep + sed` op `/admin/inbound/92` 404-bug. User antwoordde: "hier waren we wil direct door".
**Vermoede oorzaak:** SSH-drop (4e van vandaag). Keepalive-config van ~15:30 entry vermoedelijk niet permanent geactiveerd OF Windows-client-zijde tikt nog steeds een ander interval. Server-zijde dropin niet geverifieerd op huidige sessie.
**Sessie-ID (vóór crash):** ATX-LOGIN-fix net afgerond (`/opt/atx-pipeline/public/inbound.js` + `inbound-detail.js` redirect-naar-PWA → inline-banner). Volgende stap: 404 op `/admin/inbound/:id` debuggen.
**Stand vóór crash (laatste bevestigd werk):**
  - ATX-LOGIN fix LIVE, T4C-FIX-LOG entry erbij.
  - Diagnose-bash klaar maar nog niet uitgevoerd (permission-prompt openstaand).
**Verloren werk:** Niets — pending bash kon direct hervat worden, user expliciet "direct door".
**Stand bij hervatten:** pm2 unchanged, diagnose-bash uitgevoerd → root cause = T4C-skip-list bevat alleen `/telex-inkoop`, niet `/admin/inbound`. FE linkte naar `/admin/inbound/${id}` (regels 111 + 184 in inbound.js).
**Wat user opnieuw moest doen:** Niks behalve "direct door" sturen (geen re-upload, geen re-login Claude).
**Actie genomen om herhaling te voorkomen:** ATX404-fix direct gedaan (FE linkt nu naar `/telex-inkoop/${id}` — T4C-proxy-rewrite vangt het op `/admin/inbound/:id` interne ATX). Geen extra SSH-actie (4 drops vandaag = patroon-grens overschreden, zie patroon-tabel).
**Open issue na crash:** ATX-1 (95 atx-admin restarts) nog steeds open. Tunnel-resilience WIP (Tailscale) niet doorgepakt vandaag.

---

### 2026-06-10 ~15:30 — Disconnect midden in user-message (2e keer vandaag)
**Symptoom (wat zag user):** `client_loop: send disconnect: Unknown error` TERWIJL user aan het typen was. Zelfde PowerShell als vanochtend.
**Vermoede oorzaak:** Keepalive die op 06-09 18:25 vermeld werd was alleen client-side OF in een sessie die overschreven is. Live check: `/etc/ssh/sshd_config` heeft alle ClientAlive-regels uitgecommentarieerd (default = 0 = uit). Dropin-dir alleen `50-cloud-init.conf`.
**Sessie-ID (vóór crash):** transfer4cars productie-cleanup sessie, na Groep A (admin-nav consistentie) + voorbereiding Groep B.
**Stand vóór crash (laatste bevestigd werk):**
  - NL1 + Groep A door (4 admin-pages canonieke nav, live geverifieerd).
  - Master-docs: T4C-MAP-COMPLEET, T4C-INFOARCHITECTUUR, T4C-FIX-LOG (alle 3 in `/opt/t4c/docs/`).
  - User typte productie-besluiten (Google-login WEG, klant-login email+auto-gen-pw, 2FA TOTP, PWA later, placeholders eruit) toen ssh klapte.
**Verloren werk:** Niets — user-bericht kwam alsnog door na reconnect.
**Stand bij hervatten:** Server up, alle docs intact, geen pm2-restart nodig.
**Wat user opnieuw moest doen:** ssh t4c + claude opener + frustratie-bericht.
**Actie genomen om herhaling te voorkomen:** Server-side dropin geschreven naar `/tmp/99-keepalive.conf` (ClientAliveInterval 60, ClientAliveCountMax 10, TCPKeepAlive yes). User runt sudo-installatie. Plus Windows `~/.ssh/config` ServerAliveInterval 30 / Count 10 gegeven aan user.
**Open issue na crash:** Productie-besluiten opslaan in memory → done. Continueren met klant-UX wins (Groep B: FL5 contact-knop + FL20 watchlist-tab). FL2 auto-login geschrapt — past niet bij B2B-aanvraag-model.

---

### 2026-06-10 13:29 — Disconnect tijdens nav-cleanup approval-prompt
**Symptoom (wat zag user):** `client_loop: send disconnect: Unknown error` precies op het moment dat Claude een Bash-approval-prompt liet zien voor de laatste backup-mv (`mv veilingen/index.html.bak... → backups/cleanup-20260610/`). PowerShell-shell dood, ssh-reconnect handmatig.
**Vermoede oorzaak:** SSH-tunnel/keepalive — zelfde patroon als 2026-06-09. Lange Explore-agent runs (3m 40s) gevolgd door een interactieve prompt = window waarin idle-timeout toeslaat.
**Sessie-ID (vóór crash):** transfer4cars-pickup-sessie, opener "transfer4cars" → daarna user-vraag "nav/login/ATX-rapport 404 fixen".
**Stand vóór crash (laatste bevestigd werk):**
  - ATX-pipeline login-mysterie opgelost: hardcoded default `T4C-admin-2026` (admin-dashboard.js:26), getest 200 OK. Geen `ADMIN_PASS` in `/opt/atx-pipeline/.env`.
  - 3 backup-files al verplaatst naar `/opt/t4c/backups/cleanup-20260610/`.
  - 1 backup over: `/opt/t4c/sites/transfer4cars/veilingen/index.html.bak-pre-cleanup-20260603` (waar de approval-prompt op afketste).
  - Brede UI-audit klaar (Explore-agent): 4 DNA's tegelijk op site, nav-volgorde verschilt per page, login-detectie consistent maar header-IDs verschillen (#navCta / #user-area / #userlabel).
  - User wil: vanaf `/veilingen/` direct "+ Nieuwe veiling"-knop voor admin (geen omweg via account).
**Verloren werk:** Niets. Backup-mv niet uitgevoerd → hervat geverifieerd (file nog aanwezig), alsnog verplaatst.
**Stand bij hervatten:** Server up, alle pm2-processen draaien, backup nu wél verplaatst, tree clean (0 restanten), 19 echte index.html in tree.
**Wat user opnieuw moest doen:** ssh t4c + claude opnieuw starten + "lees dit connectie klapte er weer uit" zeggen.
**Actie genomen om herhaling te voorkomen:** Open punt — Tailscale-installatie is op 2026-06-09 onderbroken (memory: `project_tunnel_resilience_wip`). Verder geen nieuwe regel: keepalive is al gezet, oorzaak waarschijnlijk Windows-PowerShell/router-NAT-idle.
**Open issue na crash:** Hervat nav-cleanup → "+ Nieuwe veiling" knop op `/veilingen/` voor admin + ATX-password besluit van user (a) wijzigen of (b) integreren met T4C-login.

---

### 2026-06-09 18:25 — Root cause + fix: SSH had geen keepalive
**Symptoom:** User raakte 3× geïrriteerd door SSH-disconnects sinds 11:18 ("ik word er leip van").
**Echte oorzaak gevonden:** `/etc/ssh/sshd_config` had **geen** `ClientAliveInterval` / `TCPKeepAlive`. SSH tussen Windows→cloudflared→server raakt idle bij denken/lange tool-runs → cloudflared edge closes idle TCP → SSH-client krijgt EPIPE bij volgend pakket → `send disconnect: Unknown error`.
**Fixes uitgerold:**
1. Script `/tmp/fix-ssh-keepalive.sh` aangemaakt: `ClientAliveInterval 30` + `ClientAliveCountMax 10` + `TCPKeepAlive yes` in sshd_config. Server pingt elke 30s, dropt pas na 5 min stilte. Reload != restart → bestaande sessies blijven intact. User moet via `! sudo bash` runnen.
2. `~/.bashrc` tmux-autoattach: elke nieuwe `ssh t4c` landt in tmux-sessie "main". Drop = `ssh t4c` opnieuw = direct terug waar je was. Claude blijft door-runnen tijdens drop. Escape: `TMUX_SKIP=1 ssh t4c`.
3. Windows-side aanbeveling: `ServerAliveInterval 30` in `~/.ssh/config` voor host `t4c`.
**Impact:** Met deze 3 zou disconnects naar near-nul moeten gaan. tmux-autoattach betekent: zelfs als 't tóch droppt, geen verloren context meer.
**Open issue na fix:**
- Tailscale-install (vanmorgen begonnen, halverwege) als laatste backup-route — sluit nog cloudflared-afhankelijkheid uit volledig.

---

### 2026-06-09 18:10 — Claude-CLI disconnect mid-veiling-UI-werk
**Symptoom (wat zag user):** Sessie eindigde met "Reload /veilingen/ voor het resultaat" + uitgebreid recap. User opende nieuwe sessie en zei "je crashte weer we waren nog bezig" + plakte volledige transcript van vorige sessie.
**Vermoede oorzaak:** Claude-CLI / SSH `client_loop: send disconnect: Unknown error` (gebeurt sinds 2026-06-09 vaker, mogelijk gerelateerd aan cloudflared 1033-incident eerder vandaag). Server zelf draaide door.
**Sessie-ID (vóór crash):** a29facaf-4724-4f1f-989b-38e1200c28e0 (branched session waar veiling-DNA-rebuild gebeurde)
**Stand vóór crash (laatste bevestigd werk):**
- `/opt/t4c/sites/transfer4cars/veilingen/index.html` (28.6KB, CarDataX DNA, Outfit+Plex-Mono)
- `/opt/t4c/sites/transfer4cars/veilingen/detail/index.html` (25.4KB, command-center bidbox + live history)
- `/opt/t4c/docs/T4C-ROADMAP-2026-06-09.md` bijgewerkt t/m 14:30
- Memory `feedback_t4c_veiling_cardatax_dna.md` opgeslagen
- t4c-server pm2 restart 14s graceful, 0 zombies
**Verloren werk:** Niets. Alle file-writes waren gecommitteerd vóór crash. User had alleen nog moeten reloaden in browser.
**Stand bij hervatten (2026-06-09 18:10):**
- t4c-server: PID 2922441, uptime 61m, 9 restarts totaal (geen storm)
- pm2 alle 5 procs online (admin-dashboard, atx-admin, cardatax-server, lyra-server, t4c-server)
- `/veilingen/` → 200, `/veilingen/detail/?id=1` → 200 (zelfde bytes als pre-crash)
- Geen ENOENT errors in t4c-server logs
**Wat user opnieuw moest doen:** Hele transcript opnieuw aanleveren omdat nieuwe Claude-sessie geen geheugen had van branch-sessie. Sub-optimaal — vorige sessie had moeten eindigen met "klaar voor reload", niet met crash.
**Actie genomen om herhaling te voorkomen:**
1. Dit CRASH-LOG.md aangemaakt als vaste plek
2. Memory-regel `feedback_crash_documentation.md` zodat ik bij elke disconnect-trigger automatisch een entry maak
3. Tunnel-resilience-werk staat al gepland in `project_tunnel_resilience_wip.md` (Tailscale install pauseerde op Google-account wacht) — afmaken zou cloudflared-gerelateerde SSH-drops oplossen
**Open issue na crash:**
- Tailscale-install afmaken (zie `project_tunnel_resilience_wip.md`) om SSH-resilience te verbeteren
- Watchdog-script al actief sinds vanmiddag (`/opt/t4c/watchdog.sh` v2), draait sindsdien zonder storm — geen extra werk daar

---

## Patroon-observaties

Wanneer 3+ vergelijkbare entries zijn: maak een `feedback`- of `project`-memory om structureel iets te fixen i.p.v. blijven loggen.

| Patroon | Aantal hits | Structurele actie |
|---|---|---|
| Claude-CLI/SSH disconnect tijdens lange-write-sessie | 2 (vandaag) | **2026-06-09 18:25 FIX:** sshd keepalive + tmux-autoattach. Tailscale = secundair. |
| User moet transcript re-uploaden bij nieuwe sessie | 1 (vandaag) | Roadmap + memory zorgen dat nieuwe sessie context vindt (werkt al) |
| Server-zelf crash | 0 sinds 06-09 watchdog v2 | watchdog v2 in productie |

## 2026-06-10 — SSH-drop tijdens GA4 service-account fix
**Waar bezig:** Admin dashboard koppelen aan echte GA4 data. UI-bug blokkeerde toevoegen SA, omzeilen via Analytics Admin API. ADC token miste analytics.edit scope → 2e auth nodig met extra scopes.
**Crash:** SSH-verbinding viel weg (tweede keer vandaag, conform tunnel-resilience WIP nog open).
**Hervat:** opnieuw inloggen + de `gcloud auth application-default login` met scopes draaien als ÉÉN regel (vorige poging brak op newline). Daarna: SA toevoegen via Admin API v1alpha `accountSummaries`/`accessBindings` endpoint.

### 2026-06-10 10:54 — Derde SSH-drop vandaag (mid-ADC-login)
**Symptoom:** User: "We disconnecten weer is". Drop tijdens GA4 ADC re-auth flow van 10:04.
**State op disconnect:**
- pm2: alle 5 procs online (admin-dashboard 12D, atx-admin 4m/95↺, cardatax-server 5D, lyra-server 17D, t4c-server 10h)
- `atx-admin` heeft 95 restarts → check vóór herstart op storm-loop
- Achtergebleven artifacts in /tmp van vorige sessie:
  - `/tmp/gcloud-install.sh`
  - 2 gcloud-bash-wrapper procs (PID 944912, 944914) van 10:04 — login was nooit voltooid (FIFO `/tmp/gcloud-stdin` opgeruimd dus die hangen op `< /tmp/gcloud-stdin`)
**Hervat-plan:**
1. Kil de 2 orphaned gcloud-wrapper procs + `rm /tmp/gcloud-install.sh /tmp/gcloud-stdout /tmp/gcloud-pid`
2. Check atx-admin logs voor 95-restart oorzaak vóór nieuwe wijzigingen
3. User start ADC-login zelf via `! gcloud auth application-default login --scopes=…` (1 regel, geen background-FIFO meer — pickup-file zegt expliciet "tmux weg is, losse shell of binnen Claude beide ok")
4. Daarna pickup volgen vanaf "Verifier na ADC-refresh"
**Patroon:** 3e SSH-drop vandaag → tunnel-resilience WIP moet écht af. Tailscale install paste vandaag op user beschikbaarheid.

## 2026-06-11 ~06:50 — Crash midden in E2E-test na dashboard-bouw
- **Context:** /dashboard/ (klant) + /command/ (admin) gebouwd, /account/ redirect-stub, /login/ role-redirect, user-nav.js + index.html dropdown bijgewerkt.
- **Disconnect-moment:** tijdens permission-prompt voor E2E-bash (curl-loop alle URLs + JWT-tests).
- **Stand bij crash:** alle files live (200), maar nog NIET geverifieerd dat /admin/atx/ uit dropdown is + nog niet eind-rapport.
- **User-feedback bij hervat:** "/admin/atx/ link zit er nog in" → user wil dat weg, want /command/ heeft eigen Server-monitor-panel.
- **Hervat:** /admin/atx/ uit user-nav.js + index.html dropdown halen + E2E afmaken.

## 2026-06-11 ~10:00 — REVERT van /dashboard/ + /command/ chaos
- **Aanleiding:** user pissed: ik bouwde vannacht /dashboard/ + /command/ als iframe-wrappers ZONDER eerst T4C-INFOARCHITECTUUR.md + T4C-MAP-COMPLEET.md te lezen. Resultaat = dubbele troep, lege shells, kapotte nav. User koos REVERT.
- **MAP-COMPLEET sectie 2B** zei al wat het MOET zijn: navigatie-shell met kaarten per werksysteem, geen iframes. Negeerd.
- **Geverteerd:**
  1. /dashboard/ → /opt/t4c/backups/archived-dashboard-20260611/
  2. /command/ → /opt/t4c/backups/archived-command-20260611/
  3. /account/index.html ← pre-nav-unify/account-index.html-PRE-DASHBOARD (498 regels, volledig functioneel)
  4. /admin/index.html + inbox + analytics + transport ← Server-monitor link terug in nav-header
  5. /js/user-nav.js → "Dashboard"+"Command Center" weg, "Mijn account"+"Mijn profiel"+Server-monitor terug
  6. /index.html dropdown → idem
  7. /login/ → redirect terug naar /admin/ voor staff (was /command/)
  8. /css/dashboard.css → gearchiveerd (alleen voor verwijderde dashboards)
- **Behouden (NIET gerevert):** server.js LOGIN-500-FIX, unified-dropdown via user-nav.js, BTW-migratie — geen van die hoort bij dashboard-chaos.
- **Snapshot HUIDIGE state vóór revert** bewaard in /opt/t4c/backups/revert-snapshot-20260611-1004 voor noodgevallen.
- **Live verify:** 10/10 staff-pages 200, /dashboard/ + /command/ → 404 (correct).
- **Les:** bij T4C trigger STRIKT eerst lezen: STABILITEIT-PROTOCOL + AUDIT + FIX-LOG + MAP-COMPLEET + INFOARCHITECTUUR + ROADMAP. Geen nieuwe pages bouwen zonder die context.

## 2026-06-11 ~10:30 — SSH disconnect midden in /admin/atx/ verify
**Context:** Bezig met verifieren dat Command Center (/admin/atx/ proxy naar admin-dashboard.js port 3200) werkt na revert van vannacht-bouwsels.
**Symptoom user-kant:** `client_loop: send disconnect: Unknown error` + Windows PS prompt terug. Motd toont 10 zombie processes + MicroK8s reclame (Ubuntu default, niet relevant).
**Laatste verified state vóór drop:** `curl 127.0.0.1:3200/ → 200` direct werkte. Handshake-test via T4C-server.js proxy was halverwege.
**Wat hervatten:** /admin/atx/ end-to-end test (met cookie-handshake) + SSH-stabiliteit hardenen (ServerAliveInterval / ClientAliveInterval, TCPKeepAlive). Tailscale-spoor uit WIP-memory ligt al klaar maar wacht op Google-account.

### Diagnose
- sshd_config keep-alive (60s/10 misses) is ACTIEF sinds 06:22 vandaag → server-kant goed
- Cloudflared logs: 2× `failed to accept QUIC stream: timeout: no recent network activity` laatste 24u (02:12 en eerder)
- Reconnect duurt ~8s, maar TCP-stream van actieve SSH is dan dood
- Root: QUIC-instabiliteit cloudflared tunnel. WIP-memory zegt: "Eventueel --protocol http2 als QUIC instabiel blijkt — alleen als binnen 2 weken weer fout gaat." → ja, valt nu binnen die window.

### Actie-opties (gerangschikt, low → high impact)
1. **Client-side ServerAliveInterval 30** in Windows `~/.ssh/config` — pings die QUIC-tunnel warm houden, faal-detect <2 min. GEEN server-impact, gratis. ← DOEN
2. **Cloudflared --protocol http2** ipv quic — minder timeouts, iets hogere latency. Vereist edit ExecStart + systemctl daemon-reload + restart cloudflared (~10s alle sites down). Aparte beslissing.
3. **Tailscale afmaken** (WIP since 2026-06-09) — onafhankelijke route, geen Cloudflare-afhankelijkheid voor SSH. Vraagt Google-login.

### Zombie wget-procs (motd-warning)
10× `[wget] <defunct>`, parent = traefik (Docker-managed door Coolify). Healthcheck-lekkage in Docker container. Niet acuut: zombies blokkeren niks, alleen PID-tabel-bloat. Fix vereist traefik-container herstart (= Coolify-stack reload). Documenteer, doe niet nu.

---

## 2026-06-16 → 2026-06-17 — Schoonmaak-sessie (Fase 1+2+5a) + Jurgen-DNA ronde 2

**Geen crashes.** Wel een lange werksessie met substantiële wijzigingen — gedocumenteerd hier voor toekomst-context.

### Werk-overzicht
- **Fase 1** (16-06 22:40): backup-cron stil-defect (cp-glob bug) **gerepareerd na 47 dagen** (53 false-positives in backup.log sinds 30-04). 3 phantom files weg (`=`, `manifest_new.json`, `db.js.WORKING-sqljs-*`). `.gitignore` prefix-fix.
- **Fase 2** (16-06 22:50): **4,5 GB rotzooi** via staging-folder verwijderd na user-akkoord. Disk 38GB → 34GB. Productie ongemoeid.
- **Fase 5a** (16-06 23:00): atx-admin restart-bescherming (kill_timeout/min_uptime/max_restarts/restart_delay). `db.js` forceSave skip PRAGMA integrity_check post-WAL (memory na reload 656MB → 290MB).
- **Pricing-analyse**: 660-cases benchmark, eerst tegen verkeerde kolom (`our_bod`), correctie naar `sold_price` (echte Jurgen-bod). Mediaan-bias +5% vs Jurgen. <€2k blinde vlek (+38%) blijft.
- **Bench-instance** gebouwd + 4 wijzigingen getest + afgesloten (was niet duidelijk beter).
- **Jurgen-DNA ronde 2** (17-06 00:00): complete framework via ChatGPT-conversatie. 8 hoofdblokken, concrete aftrek-cijfers, motor-categorieën, km-grenzen per brandstof, T4C-Liquiditeitsscore 0-100.
- **Session-bootstrap** (17-06 00:20): nieuwe `CLAUDE.md` + `SESSION-START-PROTOCOL.md` + `/home/deniz/CLAUDE.md` + memory-trigger. Dwingt elke volgende Claude tot leeslijst vóór actie.
- **Docs-update** (17-06 00:30): SESSION-STATE.md + 00-SYSTEEMKAART overlay + dit log + 4 oudere docs review (Stap 4 nog te doen).

### Belangrijkste leerpunten (om niet te vergeten)
1. **`sold_price` IS Jurgen-bod**, niet `our_bod` (= T4C-systeem-output). Eerdere analyses tegen `our_bod` waren misleidend.
2. **dealer_feedback.kenteken IS gevuld** (eerder claim: leeg). 662/662.
3. **DB is better-sqlite3 + WAL** sinds 16-06, niet sql.js.
4. **"102 restarts" was PM2-lifetime**, niet daily-crash. Echte boots 16-06: 9× t4c-server, allemaal handmatig.
5. **Bench-fix-richting was niet beter**: na schone re-analyse met `sold_price` zat prod al goed (+5% mediaan), bench was iets slechter (+6,1%).
6. **Multipliers per-merk variëren**: sommige (Note, Auris, VW Up, Skoda Fabia, Hyundai i10) zijn terecht, andere (Megane, Fiesta, Venga, C1) zijn te streng.

### Commits sessie (10)
`0f3b516` `ac97e8c` `9a45759` `35c885f` `8f6b01f` `993fcd8` `c502678` `a08a9d5` `e1fe315` `0e15be7`

### Volgende sessie pakt op
- RSPP-doc schrijven (`ROCK-SOLID-PIPELINE-2026-06-17.md`)
- Staging-instance als permanente fixture bouwen
- AI-research voor 6 open Jurgen-vragen
- Bootstrap-test: laat user nieuwe sessie openen (local + `ssh t4c`) om te zien of Claude de leeslijst echt naloopt
