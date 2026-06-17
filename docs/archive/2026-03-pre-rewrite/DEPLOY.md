# T4C Enterprise v8.8 — Deployment Guide
## Van localhost naar https://transfer4cars.nl

---

## STAP 1: Lokaal testen (5 min)

```powershell
cd C:\Users\deniz\Desktop\t4c
.\START_T4C.ps1
```

Open `http://localhost:3000`:
- Landing page → klik "Inloggen"
- Login: `admin` / `t4c2025!`
- Na login → T4C taxatie tool

**Wachtwoorden wijzigen:** bewerk `backend\users.json`

---

## STAP 2: Domein naar Cloudflare verplaatsen (15 min)

1. Ga naar [cloudflare.com](https://dash.cloudflare.com) en maak een account
2. Klik **"Add a Site"** → voer `transfer4cars.nl` in
3. Kies het **Free** plan
4. Cloudflare geeft je 2 nameservers, bijv:
   ```
   anna.ns.cloudflare.com
   bob.ns.cloudflare.com
   ```
5. Ga naar je domain registrar (waar je transfer4cars.nl hebt gekocht)
6. Wijzig de **nameservers** naar de Cloudflare nameservers
7. Wacht 5-30 minuten tot de DNS is overgeschakeld
8. In Cloudflare dashboard: status wordt **"Active"** ✓

---

## STAP 3: Cloudflare Tunnel installeren (10 min)

### 3a. Download cloudflared

Download voor Windows: https://github.com/cloudflare/cloudflared/releases/latest
- Download `cloudflared-windows-amd64.exe`
- Hernoem naar `cloudflared.exe`
- Zet in `C:\cloudflared\cloudflared.exe`

### 3b. Login bij Cloudflare

```powershell
C:\cloudflared\cloudflared.exe tunnel login
```

Dit opent je browser → log in bij Cloudflare → selecteer `transfer4cars.nl`
Een certificaat wordt automatisch opgeslagen.

### 3c. Maak een tunnel aan

```powershell
C:\cloudflared\cloudflared.exe tunnel create t4c
```

Dit geeft een **Tunnel ID** (bijv. `a1b2c3d4-...`). Onthoud deze!

### 3d. DNS instellen

```powershell
C:\cloudflared\cloudflared.exe tunnel route dns t4c transfer4cars.nl
```

Dit maakt automatisch een CNAME record in Cloudflare DNS.

### 3e. Config bestand maken

Maak bestand `C:\Users\deniz\.cloudflared\config.yml`:

```yaml
tunnel: JOUW_TUNNEL_ID_HIER
credentials-file: C:\Users\deniz\.cloudflared\JOUW_TUNNEL_ID_HIER.json

ingress:
  - hostname: transfer4cars.nl
    service: http://localhost:3000
  - service: http_status:404
```

Vervang `JOUW_TUNNEL_ID_HIER` met het ID uit stap 3c.

---

## STAP 4: Live gaan! (2 min)

### Terminal 1 — T4C starten:
```powershell
cd C:\Users\deniz\Desktop\t4c
.\START_T4C.ps1
```

### Terminal 2 — Tunnel starten:
```powershell
C:\cloudflared\cloudflared.exe tunnel run t4c
```

**Klaar!** Open `https://transfer4cars.nl` in je browser.

---

## STAP 5 (Optioneel): Automatisch opstarten

Om de tunnel als Windows Service te installeren (start automatisch bij boot):

```powershell
C:\cloudflared\cloudflared.exe service install
```

En voor T4C zelf, maak een snelkoppeling in:
`C:\Users\deniz\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`
die `powershell -File "C:\Users\deniz\Desktop\t4c\START_T4C.ps1"` uitvoert.

---

## Samenvatting

| Wat | Waar |
|-----|------|
| Landing page | https://transfer4cars.nl |
| Login | https://transfer4cars.nl/login |
| T4C App | https://transfer4cars.nl/app/ |
| API | https://transfer4cars.nl/api/* |
| Admin wachtwoorden | `backend\users.json` |
| Tunnel config | `C:\Users\deniz\.cloudflared\config.yml` |

## Kosten

| Item | Kosten |
|------|--------|
| Cloudflare account | Gratis |
| Cloudflare Tunnel | Gratis |
| SSL certificaat | Gratis (via Cloudflare) |
| Domein | Al gekocht |
| **Totaal** | **€ 0 / maand** |

## Troubleshooting

**Site niet bereikbaar?**
- Check of T4C draait: `http://localhost:3000` moet werken
- Check of tunnel draait: `C:\cloudflared\cloudflared.exe tunnel run t4c`
- Check Cloudflare dashboard → DNS → moet CNAME naar tunnel hebben

**Login werkt niet?**
- Check `backend\users.json` voor juiste credentials
- Wis browser cache / incognito proberen

**Frontend niet geladen?**
- Rebuild: `cd frontend && npm run build`
- Check of `backend\public\app\index.html` bestaat
