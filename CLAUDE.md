# T4C / CarDataX — Claude Code Bootstrap
*Deze file wordt automatisch geladen bij elke sessie in /opt/t4c. Volg het protocol vóór ANY actie.*

---

# ⛔ STOP. EERST LEZEN.

Voor je iets doet aan T4C, lees in deze volgorde:

1. **`/opt/t4c/docs/SESSION-START-PROTOCOL.md`** — de 12-stap-checklist + hard-rules
2. **`/opt/t4c/docs/STABILITEIT-PROTOCOL.md`** — backup-regels, fall-back, wat niet mag
3. **`/opt/t4c/docs/00-SYSTEEMKAART-T4C.md`** — wat draait waar (canonieke map)
4. **`/opt/t4c/docs/CLEANUP-START-2026-06-16.md`** — huidige cleanup-status

**Voor pricing-werk daarbij**:

5. **`/opt/t4c/docs/JURGEN-PRICING-DNA-2026-06-17.md`** — Jurgen's framework
6. **`/opt/t4c/docs/T4C-PRICING-ROOTCAUSE-2026-06-16.md`** — bekende biases
7. **`/opt/t4c/docs/ROCK-SOLID-PIPELINE-2026-06-17.md`** (zodra geschreven) — RSPP

**Voor infra/restart-werk**:

8. **`/opt/t4c/docs/CRASH-LOG.md`** — recente incidenten

Plus altijd: `pm2 list`, `git status -s`, `git log --oneline -5`, `df -h /opt`, laatste backup-file.

---

# Hard-rules (samenvatting uit SESSION-START-PROTOCOL.md)

## Wat NOOIT mag
- `rm` in `data/`, `backups/` zonder akkoord
- `kill -9` op pm2-processen
- Edit zonder backup-pad in chat
- Pricing-wijziging direct op live (moet via staging)
- Biedingen naar Autotelex
- Wijziging aan `/opt/cardatax-app/dev|live` vanuit T4C-sessie
- Aanname zonder verificatie

## Wat ALTIJD moet
- Backup vóór elke edit op critical files (server.js, db.js, lib/, routes/, configs, html)
- Eén logische wijziging per Edit, dan smoke-test
- PM2 graceful reload, niet kill+start
- Documentatie meteen
- Memory-update bij learning of decision
- Bij twijfel: ASK over GOK

---

# Drie vragen die Claude altijd moet kunnen beantwoorden vóór actie

1. **"Wat draait er nu?"**
2. **"Wat is de pricing-stack-status?"**
3. **"Wat is het laatste belangrijke besluit?"**

Als hij dit niet kan: **eerst lezen**.

---

# Project samenvatting (snelle context)

**T4C / CarDataX** — Nederlands B2B platform voor autohandelaren. Drie gezichten:
- `transfer4cars.com/` + `/aanbod/` + `/veilingen/` — publieke verkoop site
- `transfer4cars.com/app/` — pricing-tool (CarDataX-fork) ⭐ Jurgen's daily tool
- `transfer4cars.com/admin/` — admin-paneel (Jurgen only)

CarDataX tech stack is **strikt vertrouwelijk** voor externen.

## Architectuur (kort)

| | |
|---|---|
| Server | HP Z440 in Langeraar |
| OS | Ubuntu 24.04 |
| SSH alias | `ssh t4c` (vanaf Windows) |
| Code | `/opt/t4c` (private repo `denizsenol1996-art/T4C`) |
| Backend entry | `/opt/t4c/backend/server.js` |
| DB | `/opt/t4c/data/t4c.db` — **better-sqlite3 + WAL** (sinds 16-06, niet meer sql.js!) |
| Service | PM2 process `t4c-server` port 3000 |
| Tunnel | `cloudflared` systemd service |
| Atx-pipeline | `/opt/atx-pipeline/` port 3110 (Autotelex-mails, **rapport-only**) |

## Drie pricing-endpoints
- `POST /api/dealer/price` — volle pricing (RDW + GPT + comp-engine + trade-engine + bod-curve)
- `POST /api/dealer/quick-price` — snelle pricing (comp + expert-GPT)
- `POST /api/extended-taxatie` — foto's + correcties bovenop dealer/price

## Pricing-stack status (peildatum 16-06)
- **Mediaan bias vs Jurgen-bod**: +5% (goed)
- **Resterende blinde vlekken**: <€2k auto's (+38%), 16+j auto's (mix)
- **B1 bekend**: `valuation.js:1014` `finalBod = finalHandel` — maakt trade-engine `maxBid` dead
- **Bod-curve**: vandaag geleerd uit 661 dealer_feedback cases, ratio per (prijsklasse, leeftijd)
- **Bench**: afgesloten, dir staat nog in `/home/deniz/t4c-bench/` voor heropen
- **DB-engine**: better-sqlite3 + WAL (cutover 16-06 10:54)

---

# Communicatie-stijl met Deniz

- **Nederlands**
- **Eerlijk** — bij fout/onzekerheid expliciet zeggen
- **Compact** — geen 3 pagina's als 5 zinnen volstaan
- **Geen overdreven enthousiasme**
- **Bevestig grote stappen** — vraag akkoord bij irreversible acties
- **Géén emoji's** tenzij expliciet gevraagd
- **Bij grote wijzigingen**: spec → backup → edit → test → commit → doc — geen patches

---

# Bij elke sessie-afsluiting

- Update `SESSION-STATE.md` met huidige situatie
- Update relevante cleanup/status-docs
- Update memory bij learning
- Commit alle drift in git
- Verifieer productie 200 OK

---

*Eigenaar: Deniz. Wijziging alleen op expliciet user-akkoord.*
*Volledige protocol: `/opt/t4c/docs/SESSION-START-PROTOCOL.md`*
