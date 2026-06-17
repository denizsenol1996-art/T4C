# T4C Session-Start Protocol
*Verplicht voor Claude bij elke nieuwe sessie waarin T4C/CarDataX wordt aangeraakt.*

Datum: 2026-06-17 · Versie 1.0 · Eigenaar: Deniz

---

## Waarom dit protocol bestaat

Eerdere sessies begonnen met handelen vóór begrijpen. Resulteerde in:
- Fouten over wat draait (sql.js vs WAL)
- Wijzigingen op fragiele basis
- Verloren context tussen sessies
- Verkeerde aannames over ground truth

Dit protocol dwingt **kennis vóór actie**. Claude moet alle 12 stappen doorlopen voordat hij een wijziging mag voorstellen, laat staan uitvoeren.

---

## Verplichte leeslijst (in deze volgorde)

### Tier 1 — Niveau van begrip vóór elke actie
1. **`/opt/t4c/docs/STABILITEIT-PROTOCOL.md`** — wat mag/niet mag, backup-regels, fall-back
2. **`/opt/t4c/docs/00-SYSTEEMKAART-T4C.md`** — wat draait waar (canonieke systeem-map)
3. **`/opt/t4c/docs/CLEANUP-START-2026-06-16.md`** — huidige cleanup-status (Fase 1+2+5a)
4. **`/opt/t4c/CLAUDE.md`** — project-context (deze file verwijst naar de rest)

### Tier 2 — Voor pricing-werk
5. **`/opt/t4c/docs/JURGEN-PRICING-DNA-2026-06-17.md`** — Jurgen's volledige pricing-framework
6. **`/opt/t4c/docs/T4C-PRICING-ROOTCAUSE-2026-06-16.md`** — bekende biases + oorzaken
7. **`/opt/t4c/docs/ROCK-SOLID-PIPELINE-2026-06-17.md`** *(nog te maken)* — RSPP-proces voor pricing-wijzigingen

### Tier 3 — Voor infra/restart-werk
8. **`/opt/t4c/docs/CRASH-LOG.md`** — recente incidenten

---

## De 12-stap-checklist (door deze stappen vóór ANY actie)

```
□  1. Lees Tier 1 — kort excerpt + sleutelregels
□  2. Lees Tier 2 als pricing → ja/nee
□  3. Lees Tier 3 als infra/restart → ja/nee
□  4. Check `pm2 list` — welke processen draaien?
□  5. Check `pm2 logs t4c-server --err --nostream --lines 30` — recent errors?
□  6. Check `git status -s` in /opt/t4c — uncommitted drift?
□  7. Check `git log --oneline -5` — wat is recent gewijzigd?
□  8. Check disk-usage `df -h /opt` — alarm?
□  9. Check backup-status — laatste backup-file in /opt/t4c/backups/db_*.db
□ 10. Verwoord aan user: "Ik heb gelezen X. Huidige state is Y. Voorgesteld pad is Z."
□ 11. Wacht op user-akkoord vóór wijziging
□ 12. Backup vóór elke kritische edit (server.js, db.js, lib/, routes/, configs)
```

---

## Hard-rules die altijd gelden

### Wat NIET mag (uit memory + protocol)
- ❌ `rm` in `/opt/t4c/data/`, `/opt/t4c/backups/`, `/opt/atx-pipeline/data/` zonder expliciet akkoord
- ❌ `kill -9` op t4c-server / atx-admin / cardatax-server (graceful SIGTERM)
- ❌ Edit zonder backup-pad in chat genoemd
- ❌ Schema-change zonder rollback-plan
- ❌ Pricing-wijziging direct op live (moet via staging/bench)
- ❌ Biedingen naar Autotelex (atx-pipeline rapport-only)
- ❌ Wijziging aan `/opt/cardatax-app/dev` of `/opt/cardatax-app/live` vanuit T4C-sessie

### Wat WEL altijd moet
- ✅ Backup vóór elke edit op critical files
- ✅ Eén logische wijziging per Edit, dan smoke-test
- ✅ PM2 graceful reload, niet kill+start
- ✅ Documentatie meteen, niet "later"
- ✅ Memory-update bij learning of decision
- ✅ Bij twijfel: ASK over GOK

---

## Drie staat-vragen die Claude altijd moet kunnen beantwoorden

Voor hij iets voorstelt, moet Claude **mondeling** kunnen aangeven:

1. **"Wat draait er nu?"** — pm2 status, welke processen, welke poorten, recente restarts
2. **"Wat is de pricing-stack-status?"** — laatste commit, uncommitted drift, bod-curve aan/uit, bench wel/niet actief
3. **"Wat is het laatste belangrijke besluit?"** — uit memory + CLEANUP-doc + git log

Als hij dit niet kan, **leest hij eerst de docs**.

---

## Wat Claude NOOIT mag aannemen

- "De DB is sql.js" — **fout**, sinds 16-06 better-sqlite3+WAL
- "Jurgen heeft transactie-data" — **fout**, alleen Jurgen-bod via dealer_feedback
- "our_bod = Jurgen-bod" — **fout**, our_bod = T4C-systeem-bod, sold_price = Jurgen-bod
- "Bench draait" — **check**, na sessie is bench afgesloten
- "OPENAI_API_KEY werkt" — **check** in DB-settings tabel (niet .env alleen)
- "Backup-cron werkt" — **gefixt 16-06**, oude versie was stil kapot sinds 30-04

Elke aanname **expliciet verifiëren** vóór actie.

---

## RSPP — Rock-Solid Pricing Pipeline (samenvatting)

Elke pricing-wijziging moet 6 gates passeren:
1. **Spec** (max 1 pagina doc in `/opt/t4c/docs/specs/`)
2. **Code-review tegen DNA**
3. **Unit-tests**
4. **Golden replay** (100 cases, max 5% afwijking)
5. **Shadow-mode 24u** op productie
6. **Jurgen sign-off** op 10 spread-cases

Geen pricing-wijziging buiten RSPP. Volledige beschrijving in `ROCK-SOLID-PIPELINE-2026-06-17.md` (nog te schrijven).

---

## Communicatie-stijl

- **Nederlands** — Deniz spreekt Nederlands met Claude
- **Eerlijk** — als ik (Claude) iets niet weet of fout had, expliciet zeggen
- **Compact** — geen 3 pagina's als 5 zinnen volstaan
- **Geen overdreven enthousiasme** — feiten en concrete stappen
- **Bevestig grote stappen** — vraag akkoord bij irreversible acties
- **Géén emoji's** tenzij Deniz expliciet vraagt

---

## Locaties van gevoelige info

| Info | Locatie | Notes |
|---|---|---|
| OpenAI API key | `settings`-tabel in `t4c.db` (`api_key_OPENAI_API_KEY`) | `.env` is fallback |
| JWT secret | `settings.jwt_secret` (lowercase) | `.env` versie is dead code |
| Anthropic key | `.env` `ANTHROPIC_API_KEY` | |
| Cloudflare tunnel token | Cloudflare-dashboard | niet on-server |
| Database paden | `T4C_DATA_DIR` env-var, default `/opt/t4c/data` | |
| Photos | `/opt/t4c/data/photos/inspections/<plate>/` | |

---

## Bij elke sessie-afsluiting

- Update `SESSION-STATE.md` met huidige situatie
- Update `CLEANUP-START-2026-06-16.md` (of opvolger) als er cleanup-werk is gedaan
- Update memory bij learning of decision
- Commit alle drift in git
- Verifieer productie 200 OK

---

*Dit protocol is bindend. Wijziging alleen op expliciet user-akkoord.*
