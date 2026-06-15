# SESSION STATE — laatst bijgewerkt 2026-06-15 door Claude

## Waar zijn we
Schoonmaak-/werkend-maken-traject van het hele T4C-systeem, na een complete read-only audit (zie `docs/00-SYSTEEMKAART-T4C.md` = bron van waarheid). Werkwijze: 1 fix per keer, backup + test + bewijs, niks breken.

## Klaar (deze sessie)
- **Veiligheidsbasis**: t4c.db-backup + baseline-commit `6769bbe` (live code = git) + Postgres-dumps dev/live.
- **Cockpit-portaal**: pm2 `t4c-cockpit` :3300 (read-only: live-staat + bestand-browser + kaart + accuratesse). `ssh -L 3300:127.0.0.1:3300 t4c` → Admin / Prive12345!.
- **atx-dashboard beveiligd**: wachtwoord uit code → .env (Prive12345!), cookie ondertekend.
- **Leer-lus aangesloten** (commit `7ff0f38`): `routes/groundtruth.js` koppelt dealer_feedback op kenteken (662/662), `/api/groundtruth/stats` meet accuratesse (mediaan 17%, bias +11%, binnen-5% 23,8%). Cockpit-tab Accuratesse.
- **B1 getest, NIET toegepast**: risico-bod is slechter op 660 echte deals (mediaan 20,4% vs 17%). bod=handelswaarde blijft.

## Volgende stap
- #8 doc-wildgroei archiveren naar één bron (00-SYSTEEMKAART). #9 auto-start afronden (deze hooks).

## Geparkeerd (op gebruiker)
- #4 CarDataX dev/live (Jurgen-beslissing) · #6 cardatax-dev-fixes (hangt aan #4) · #7 opruimen/wissen (archiveren-vs-wissen keuze).

## Open issues / feiten
- live t4c.db = sql.js in-memory → nooit extern schrijven; via app-db-laag. t4c-server start traag (~10s).
- CarDataX prod draait zonder engine op lege DB (kern van #4).
