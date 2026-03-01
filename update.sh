#!/bin/bash
# T4C Update Script — v10.6.0
# Gebruik: ./update.sh
# Dit script haalt de nieuwste versie op van GitHub en herstart de server.

set -e

echo "========================================"
echo "  Transfer4Cars — Update"
echo "========================================"
echo ""

# Huidige versie
CURRENT=$(node -e "console.log(require('./manifest.json').version)" 2>/dev/null || echo "onbekend")
echo "Huidige versie: $CURRENT"
echo ""

# Pull nieuwste code van GitHub
echo "[1/4] Code ophalen van GitHub..."
git pull origin main
echo ""

# Nieuwe versie
NEW=$(node -e "console.log(require('./manifest.json').version)" 2>/dev/null || echo "onbekend")
echo "Nieuwe versie: $NEW"
echo ""

# Dependencies installeren (alleen als package.json is veranderd)
echo "[2/4] Dependencies checken..."
cd backend
if git diff HEAD@{1} --name-only 2>/dev/null | grep -q "package.json"; then
  echo "  → package.json gewijzigd, npm install..."
  npm install --production
else
  echo "  → Geen wijzigingen in dependencies"
fi
cd ..
echo ""

# Server herstarten
echo "[3/4] Server herstarten..."
if command -v pm2 &> /dev/null; then
  pm2 restart t4c-server 2>/dev/null || pm2 start backend/server.js --name t4c-server
  echo "  → PM2: server herstart"
elif command -v systemctl &> /dev/null && systemctl is-active --quiet t4c; then
  sudo systemctl restart t4c
  echo "  → Systemd: server herstart"
else
  echo "  → Let op: herstart de server handmatig (node backend/server.js)"
fi
echo ""

# Klaar
echo "[4/4] Update compleet!"
echo "========================================"
echo "  $CURRENT → $NEW"
echo "========================================"
echo ""
echo "Controleer: http://localhost:3000/api/health"
