#!/bin/bash
cd "$(dirname "$0")/backend"

echo ""
echo "  T4C Platform v10.2.0"
echo "  ═════════════════════"
echo ""

# Check Node
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js niet gevonden!"
  echo "Install: https://nodejs.org"
  exit 1
fi

# Auto install
if [ ! -d "node_modules" ]; then
  echo "[SETUP] Dependencies installeren..."
  npm install
  echo "[SETUP] Klaar!"
  echo ""
fi

echo "  Admin Panel:  http://localhost:3000/admin/"
echo "  Verkoop Site: http://localhost:3000/verkoop/"
echo "  Veilingen:    http://localhost:3000/verkoop/veilingen/"
echo ""
echo "  Login: admin / t4c2025!"
echo ""

node server.js
