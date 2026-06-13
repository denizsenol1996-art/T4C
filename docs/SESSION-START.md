# T4C — SESSION-START (lees als eerste)

> **STOP — bij T4C werk:**
> 1. Lees DIT bestand volledig.
> 2. Lees `STABILITEIT-PROTOCOL.md` sectie A (A0-A5).
> 3. Lees "Wat is open" hieronder.
> 4. PAS DAN edits/builds.

---

## 1. Stack

Transfer4cars.com = veiling + B2B-platform. Node.js (Express) + sql.js (in-memory SQLite -> /opt/t4c/data/t4c.db) + static HTML/CSS/JS. Live via Cloudflare-tunnel naar localhost:3000.

## 2. Services (geverifieerd 2026-06-11 14:33)

| Proces | Port | Status |
|---|---|---|
| t4c-server | 3000 | online, db.js sanitatie actief |
| admin-dashboard (Command Center) | 3200 | stabiel |
| atx-admin | 3110 | online, max_memory 512MB |
| cardatax-server | 4000 | stabiel |
| lyra-server | 4500 | stabiel |

## 3. Routes

- Klant: / /veilingen/ /aanbod/ /transport/ /account/ /login/ /telex-inkoop/ /app/
- Staff: /admin/ /admin/inbox/ /admin/transport/ /admin/analytics/ /admin/atx/
- 404 (bewust): /dashboard/ /command/

## 4. Gefixt 2026-06-11

- SQL undefined-bind crash -> db.js sanitatie (undefined->null)
- MAIL log-spam -> cooldown na 3 fails (15 min)
- atx-admin restart-loop -> max_memory 256->512MB

## 5. Open

- SMTP mail.zxcs.nl 451 error (provider-issue, 7 emails in queue)
- Tailscale wacht op Google-login
- Google-login-keuze wacht op Jurgen
- Docs-cleanup (16->5)

## 6. Hard rules

1. Backup voor elke edit
2. Lees file voor Edit
3. Een wijziging per keer
4. Geen kill -9 / pm2 delete / rm in data/backups
5. Bij twijfel: vraag

## 7. NIET doen

- Geen /command/ of /dashboard/ rebouwen zonder akkoord
- /app/ blijft (CarDataX)
- Geen Tailscale/SSH aanpassingen zonder vraag
