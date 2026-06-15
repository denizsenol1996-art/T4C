# CarDataX dev/live — cutover-voorstel (#4 + #6)
*2026-06-15. Read-only onderzocht, niets gewijzigd. Beslissing/uitvoering = Jurgen-niveau (raakt klant-prod + data).*

## Het probleem (geverifieerd op de server)
- **prod** `app.cardatax.com` (container `cardatax-app-live`, git-branch **`main`**, DB **`cardatax_live`**): `/app` heeft **geen `engine/`, geen `workers/`**, `/api/auto` = 404, en `cardatax_live` heeft **geen `market_listings`** (lege DB).
- **dev** `dev.cardatax.com` (container `cardatax-app-dev`, branch **`dev`**, DB **`cardatax_dev`**): hier draait ALLE werkende techniek — engine, comparable, synthesis, arbitrage, scrapers, **310k listings**.
- **Oorzaak:** branch `dev` is **nooit naar `main` gemerged**, en `cardatax_live` is nooit gevuld. Coolify deployt prod van `main` → dus prod krijgt nooit de engine.
- **Deploy-mechanisme:** geen git-hook; Coolify bouwt via het **panel/API** (`admin.transfer4cars.com`:8000). Een code-wijziging op disk doet niets tot Coolify (her)bouwt.

## Wat "prod werkend maken" vereist — volgorde
1. **Dev-bugfixes eerst** (op `dev`, dev-only, daarna mee in de merge) — dit is #6:
   - arbitrage al gefixt (`c97c305`, alleen nog niet uitgerold).
   - `enabled=f` scraper écht laten stoppen (`workers/scraper-base.js:59-61` + health-`ok`-overschrijving `:90-91`).
   - worker betrouwbaar starten via **Dockerfile-CMD** i.p.v. de cron-watchdog (nu los root-proces).
   - batch-gate AS24-BE/DE meenemen (`workers/index.js:55`); hardcoded scores (liquidity/risk/velocity 50/40/50) vervangen of duidelijk als placeholder labelen.
2. **`dev` → `main` mergen** → brengt engine/workers/scrapers/arbitrage naar de prod-bron.
3. **`cardatax_live` vullen**: `pg_restore` van de dev-dump (`/opt/t4c/data/backups/pg/cardatax_dev-20260615.dump`, 44M) → `cardatax_live`. (Backup is er al.)
4. **Coolify: live-app redeployen** (rebuild van `main`) via panel.
5. **Worker op live** laten draaien + **de 04:00-cron** (nu UIT) opnieuw beoordelen — met live gevuld is de oude richting `live→dev --clean` nu juist de verkeerde kant op gevaarlijk.

## Beslissingen voor Jurgen
- **Eén canonieke DB** of dev+live gescheiden houden? (nu disjunct → dubbele scrape van dezelfde NL-markt; t4c.db 308k én Postgres 306k.)
- **Routing**: na redeploy in Cloudflare-dashboard checken dat `app.cardatax.com` naar de juiste container/poort wijst (tunnel-config zit in dashboard, niet op de server).
- **Timing**: korte downtime bij live-redeploy → rustig moment kiezen.

## Mijn advies
- **Stap 1 (dev-bugfixes)** kan ik nu voorbereiden/committen op `dev` (veilig, dev-only); uitrollen = één Coolify-deploy.
- **Stap 2–5 = de echte cutover**: samen met Jurgen, met de dev-DB-dump als rollback (al gemaakt), met een afgesproken terugrol-pad. Niet solo, niet ongepland.
- Tot die cutover: prod cardatax blijft een marketing-pagina op een lege DB — dat is de status quo, niets wordt slechter.

## Wat ik NIET zonder go doe
De merge naar `main`, het vullen van `cardatax_live`, en de Coolify-redeploy van prod — dat raakt klant-data en de live site. Zeg "go" en ik bereid het stap voor stap voor (eerst dev-bugfixes + dry-run), of we wachten op Jurgen.
