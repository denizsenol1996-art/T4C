# ✅ HERSTELPUNT — ROCK SOLID (2026-06-16)
*Bekend-goede staat van transfer4cars.com. Alles live geverifieerd. Zet hier naar terug als er ooit iets stuk gaat.*

## Wat is op dit punt goed (en bewezen)
- **DB = better-sqlite3 + WAL** (on-disk, crash-safe) — geen sql.js in-memory meer.
- **Bod-curve live**: bod = verkoopadvies × ratio(prijsklasse×leeftijd), bias +11% → 0% (held-out). BMW 2005/295k: bod €1.950.
- **Leerlus actief**: elke taxatie wordt gemeten tegen echte uitkomst (accuracy_log).
- **Cockpit** (pm2 t4c-cockpit:3300, Admin/Prive12345!), **auto-start** (SessionStart-hook).
- t4c-server health 200, journal_mode=wal, data intact (taxaties ~4322, 311k listings).

## Hoe je naar dit punt terugzet

### Code terug (git)
```bash
cd /opt/t4c
git stash        # eventuele losse wijzigingen wegzetten
git checkout ROCK-SOLID-2026-06-16     # of: git reset --hard ROCK-SOLID-2026-06-16
```
Tag = `ROCK-SOLID-2026-06-16` (commit d5c6dcb).

### Database terug (clean snapshot)
```bash
pm2 stop t4c-server
cp /opt/t4c/data/SAFE-CLEAN-rocksolid-20260616.db /opt/t4c/data/t4c.db
rm -f /opt/t4c/data/t4c.db-wal /opt/t4c/data/t4c.db-shm
pm2 restart t4c-server --update-env
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health   # verwacht 200
```

### DB-motor terug naar sql.js (alleen als WAL ooit problemen geeft)
```bash
cd /opt/t4c/backend
mv db.js db.bsqlite.js && mv db.sqljs.bak.js db.js
pm2 restart t4c-server --update-env
```

## Artefacten (op de server)
- Git-tag: `ROCK-SOLID-2026-06-16`
- DB-snapshot: `/opt/t4c/data/SAFE-CLEAN-rocksolid-20260616.db` (read-only)
- DB-backup: `/opt/t4c/data/backups/t4c-voor_WAL-cutover...db`
- Oude sql.js-laag: `/opt/t4c/backend/db.sqljs.bak.js`
- Pre-WAL SAFE: `/opt/t4c/data/SAFE-pre-wal-cutover-20260616.db`
