# Transfer4Cars — Server, GitHub & Apps Setup Guide
## v10.6.0 — Command Center

---

## 1. Lokale Server Opzetten

### Wat je nodig hebt

**Hardware (minimum):**
- Mini-PC of oude desktop (bijv. Intel NUC, Lenovo ThinkCentre Tiny, Dell OptiPlex Micro)
- 8GB RAM (16GB aanbevolen)
- 256GB SSD voor het systeem
- 1TB+ HDD/SSD voor data (foto's, documenten)
- Bekabelde internetverbinding (geen Wi-Fi voor een server)

**Aanbevolen setup (~€200-400 tweedehands):**
- Lenovo ThinkCentre M920q of Dell OptiPlex 7070 Micro
- Intel i5 8e/9e gen, 16GB RAM
- 256GB NVMe + 2TB externe SSD voor opslag
- UPS (noodstroom) — bijv. APC Back-UPS 700VA (~€80)

**Software:**
- Ubuntu Server 24.04 LTS (gratis)
- Node.js 20 LTS
- PM2 (process manager)
- Nginx (reverse proxy)
- Certbot (SSL certificaten)

### Installatie Stappen

```bash
# 1. Ubuntu Server installeren (via USB stick)
# Download: https://ubuntu.com/download/server

# 2. Basis updates
sudo apt update && sudo apt upgrade -y

# 3. Node.js 20 installeren
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 4. PM2 installeren (houdt je server draaiende)
sudo npm install -g pm2

# 5. Nginx installeren (reverse proxy)
sudo apt install -y nginx

# 6. Git installeren
sudo apt install -y git

# 7. Firewall instellen
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

### Nginx Configuratie

```nginx
# /etc/nginx/sites-available/t4c
server {
    listen 80;
    server_name cardatax.nl www.cardatax.nl transfer4cars.com www.transfer4cars.com;

    # Redirect naar HTTPS (na Certbot setup)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M;
    }
}
```

```bash
# Activeer de config
sudo ln -s /etc/nginx/sites-available/t4c /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# SSL certificaat (gratis via Let's Encrypt)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d cardatax.nl -d www.cardatax.nl -d transfer4cars.com -d www.transfer4cars.com
```

### Project Deployen

```bash
# Project directory aanmaken
sudo mkdir -p /opt/t4c
sudo chown $USER:$USER /opt/t4c

# Code ophalen van GitHub (zie sectie 2)
cd /opt/t4c
git clone https://github.com/JOUW-USERNAME/t4c.git .

# Dependencies installeren
cd backend
npm install --production

# .env aanmaken
cp .env.example .env
nano .env  # Vul je API keys etc. in

# Data directory aanmaken
mkdir -p /opt/t4c/data
mkdir -p /opt/t4c/logs
mkdir -p /opt/t4c/uploads

# Server starten met PM2
pm2 start server.js --name t4c-server
pm2 save
pm2 startup  # Start automatisch na reboot
```

### Port Forwarding (Router)

Om je server bereikbaar te maken vanuit het internet:

1. Log in op je router (meestal 192.168.1.1)
2. Zoek "Port Forwarding" of "NAT"
3. Voeg toe:
   - Poort 80 → IP van je server : 80
   - Poort 443 → IP van je server : 443
4. Geef je server een vast IP-adres (DHCP reservering)

### Domein Koppelen

Bij je domeinregistrar (bijv. TransIP, Antagonist):
- A record: `cardatax.nl` → jouw publieke IP
- A record: `transfer4cars.com` → jouw publieke IP

> **Tip:** Gebruik een Dynamic DNS service (bijv. DuckDNS, gratis) als je geen vast IP hebt van je provider.

---

## 2. GitHub Opzetten

### Eenmalig: Account & Repository

1. Ga naar https://github.com en maak een account aan
2. Maak een nieuwe repository:
   - Naam: `t4c`
   - **Private** (belangrijk!)
   - Geen README/license aanvinken

### Op je server: Git instellen

```bash
# Git configureren
git config --global user.name "Jouw Naam"
git config --global user.email "jouw@email.nl"

# SSH key maken (veiliger dan wachtwoord)
ssh-keygen -t ed25519 -C "jouw@email.nl"
# Enter, enter, enter (standaard locatie, geen wachtwoord)

# Toon de key
cat ~/.ssh/id_ed25519.pub
# Kopieer deze tekst
```

3. Op GitHub: Settings → SSH Keys → New SSH Key → Plak de key

### Eerste keer code uploaden

```bash
cd /opt/t4c
git init
git remote add origin git@github.com:JOUW-USERNAME/t4c.git
git add .
git commit -m "v10.6.0 — Command Center"
git branch -M main
git push -u origin main
```

### Updaten (dagelijks gebruik)

Als ik een update maak, push ik het naar GitHub. Jij doet dan:

```bash
cd /opt/t4c
./update.sh
```

Dat is alles. Het script haalt de code op, installeert dependencies als nodig, en herstart de server.

---

## 3. Capacitor Apps Bouwen

### Vereisten op je computer (Mac of Windows)

```bash
# Node.js installeren (als je dat nog niet hebt)
# Download: https://nodejs.org

# Android Studio installeren (voor Android apps)
# Download: https://developer.android.com/studio

# Voor iOS (alleen op Mac):
# Xcode installeren via App Store
```

### Transfer4Cars App

```bash
cd apps/transfer4cars

# Dependencies installeren
npm install

# Web content klaarzetten
npm run build

# Capacitor initialiseren
npx cap add android
npx cap add ios  # alleen op Mac

# Android app openen in Android Studio
npx cap sync
npx cap open android
```

In Android Studio:
1. Wacht tot Gradle klaar is met synchroniseren
2. Klik op ▶ Run om te testen op emulator of telefoon
3. Build → Generate Signed Bundle/APK voor de Play Store

### CardDatax Taxatie App

```bash
cd apps/cardatax-taxatie

# Dependencies installeren
npm install

# Web content klaarzetten
npm run build

# Capacitor initialiseren
npx cap add android
npx cap add ios

# Android app openen
npx cap sync
npx cap open android
```

### App Updaten (na code wijzigingen)

```bash
# Na elke wijziging aan de web code:
npm run build        # Kopieer web bestanden
npx cap sync         # Synchroniseer met native project
npx cap open android # Open in Android Studio en test
```

### Play Store Publiceren

1. **Google Play Developer account** aanmaken ($25 eenmalig)
   - https://play.google.com/console
2. In Android Studio: Build → Generate Signed Bundle
3. Upload de .aab naar Play Console
4. Vul de store-vermelding in (beschrijving, screenshots, icoon)
5. Review duurt 1-3 dagen

### App Store Publiceren (iOS)

1. **Apple Developer account** aanmaken ($99/jaar)
   - https://developer.apple.com
2. In Xcode: Product → Archive
3. Upload via Xcode naar App Store Connect
4. Review duurt 1-7 dagen

---

## 4. Projectstructuur

```
t4c/
├── backend/
│   ├── server.js          ← Hoofd-server
│   ├── db.js              ← Database helpers
│   ├── guardian.js         ← Security monitoring
│   ├── branding.js         ← White-label support
│   ├── package.json
│   └── .env               ← GEHEIM (staat niet op GitHub)
├── sites/
│   ├── cardatax/
│   │   ├── app/           ← Desktop web app
│   │   ├── m/             ← Mobiele web app (basis voor Capacitor)
│   │   ├── login/         ← Login pagina
│   │   ├── admin/         ← Admin panel
│   │   └── download/      ← Download pagina
│   └── transfer4cars/
│       ├── index.html     ← Showroom
│       └── aanbod/        ← Aanbod pagina
├── apps/
│   ├── transfer4cars/     ← Capacitor app (verkoop/veilingen)
│   │   ├── package.json
│   │   ├── capacitor.config.ts
│   │   ├── build.js
│   │   └── www/           ← (wordt gegenereerd)
│   └── cardatax-taxatie/  ← Capacitor app (taxatie)
│       ├── package.json
│       ├── capacitor.config.ts
│       ├── build.js
│       └── www/           ← (wordt gegenereerd)
├── data/                  ← Database (staat niet op GitHub)
├── logs/                  ← Logbestanden (staat niet op GitHub)
├── manifest.json          ← Versie & configuratie
├── update.sh              ← Update script
├── .gitignore             ← Bestanden die niet naar GitHub gaan
└── README.md
```

---

## 5. Kosten Overzicht

| Item | Kosten | Eenmalig/Maandelijks |
|------|--------|---------------------|
| Mini-PC (tweedehands) | €200-400 | Eenmalig |
| UPS noodstroom | €80 | Eenmalig |
| Externe SSD 2TB | €100-150 | Eenmalig |
| Domein cardatax.nl | €10/jaar | Jaarlijks |
| Domein transfer4cars.com | €12/jaar | Jaarlijks |
| SSL certificaat | Gratis | (Let's Encrypt) |
| GitHub (privé repo) | Gratis | (Free tier) |
| Google Play Developer | €25 | Eenmalig |
| Apple Developer | €99/jaar | Jaarlijks |
| Stroom server | ~€5/maand | Maandelijks |
| **Totaal jaar 1** | **~€550-800** | |
| **Totaal jaar 2+** | **~€180/jaar** | |

---

## 6. Checklist

- [ ] Mini-PC/server aanschaffen
- [ ] Ubuntu Server installeren
- [ ] Node.js, PM2, Nginx installeren
- [ ] GitHub account aanmaken
- [ ] SSH key instellen
- [ ] Code naar GitHub pushen
- [ ] Domein(en) koppelen aan server IP
- [ ] SSL certificaat instellen
- [ ] .env configureren met API keys
- [ ] Server testen: http://localhost:3000/api/health
- [ ] Android Studio installeren
- [ ] Transfer4Cars app bouwen & testen
- [ ] CardDatax Taxatie app bouwen & testen
- [ ] Google Play Developer account aanmaken
- [ ] Apps publiceren
