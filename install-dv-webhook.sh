#!/bin/bash
# ══════════════════════════════════════════════════════════════
# DV.nl Webhook Installer for Transfer4Cars
# Run on the server: bash /opt/t4c/backend/install-dv-webhook.sh
# ══════════════════════════════════════════════════════════════

set -e
cd /opt/t4c

echo "═══════════════════════════════════════════"
echo "  DV.nl Webhook Installer"
echo "═══════════════════════════════════════════"

# 1. Install fast-xml-parser dependency
echo ""
echo "[1/5] Installing fast-xml-parser..."
cd /opt/t4c/backend
npm install fast-xml-parser --save
echo "✓ fast-xml-parser installed"

# 2. Verify dv-webhook.js exists
echo ""
echo "[2/5] Checking dv-webhook.js..."
if [ ! -f /opt/t4c/backend/dv-webhook.js ]; then
  echo "✗ ERROR: /opt/t4c/backend/dv-webhook.js not found!"
  echo "  Copy it first: cp /path/to/dv-webhook.js /opt/t4c/backend/"
  exit 1
fi
echo "✓ dv-webhook.js found"

# 3. Add env vars to .env (if not already there)
echo ""
echo "[3/5] Updating .env..."
if ! grep -q "DV_WEBHOOK_USER" /opt/t4c/backend/.env 2>/dev/null; then
  echo "" >> /opt/t4c/backend/.env
  echo "# DV.nl Webhook (eigenwebsite.dv.nl)" >> /opt/t4c/backend/.env
  echo 'DV_WEBHOOK_USER=transfer4' >> /opt/t4c/backend/.env
  echo 'DV_WEBHOOK_PASS=c5eLtlGy!' >> /opt/t4c/backend/.env
  echo "✓ DV credentials added to .env"
else
  echo "✓ DV credentials already in .env"
fi

# 4. Patch server.js to load the webhook module
echo ""
echo "[4/5] Patching server.js..."

# Check if already patched
if grep -q "dv-webhook" /opt/t4c/backend/server.js; then
  echo "✓ server.js already patched"
else
  # Create backup
  cp /opt/t4c/backend/server.js /opt/t4c/backend/server.js.bak-dv
  echo "  Backup: server.js.bak-dv"
  
  # Strategy: Insert the require + setup call right after the server starts listening
  # We look for the STARTUP line and add our code after it
  node -e "
const fs = require('fs');
let code = fs.readFileSync('/opt/t4c/backend/server.js', 'utf8');

// Add require at top (after existing requires)
const requireLine = 'const { setupDVWebhookRoutes } = require(\"./dv-webhook\")';
const topMarker = 'const { initDB, stmts';
if (code.includes(topMarker)) {
  code = code.replace(topMarker, requireLine + '\n' + topMarker);
  console.log('  Added require at top');
}

// Add setup call before server.listen or after app = express()
// Look for the pattern where routes are being set up
const setupCall = '\n// ═══ DV.nl WEBHOOK ═══\nsetupDVWebhookRoutes(app, { run, queryAll, queryOne, scheduleSave: () => {} })\nconsole.log(\"[DV-WEBHOOK] Endpoint active: POST /api/dv/webhook\")\n';

// Insert before the first app.listen or before STARTUP
const listenMarker = 'app.listen(';
const startupMarker = '[STARTUP]';

// Try to find a good insertion point - before the listen call
const listenIdx = code.indexOf(listenMarker);
if (listenIdx > -1) {
  // Find the start of the line containing app.listen
  let lineStart = code.lastIndexOf('\n', listenIdx);
  code = code.slice(0, lineStart) + setupCall + code.slice(lineStart);
  console.log('  Added setup call before app.listen');
} else {
  console.log('  WARNING: Could not find app.listen - manual insertion needed');
}

fs.writeFileSync('/opt/t4c/backend/server.js', code);
console.log('  ✓ server.js patched');
"
fi

# 5. Restart server
echo ""
echo "[5/5] Restarting server..."
cd /opt/t4c
pm2 restart t4c-server
sleep 4

echo ""
echo "═══════════════════════════════════════════"
echo "  Checking server status..."
echo "═══════════════════════════════════════════"

# Check for errors
ERRORS=$(pm2 logs t4c-server --err --lines 5 --nostream 2>&1)
if echo "$ERRORS" | grep -qi "error\|fatal\|cannot"; then
  echo ""
  echo "⚠ ERRORS DETECTED:"
  echo "$ERRORS"
  echo ""
  echo "Rolling back..."
  cp /opt/t4c/backend/server.js.bak-dv /opt/t4c/backend/server.js
  pm2 restart t4c-server
  echo "Rolled back to backup. Fix the errors and try again."
  exit 1
else
  echo "✓ No errors"
fi

# Check if webhook responds
echo ""
echo "Testing webhook health..."
sleep 1
RESPONSE=$(curl -s http://localhost:3000/api/dv/webhook 2>/dev/null)
if echo "$RESPONSE" | grep -q "ok"; then
  echo "✓ Webhook responding: $RESPONSE"
else
  echo "⚠ Webhook not responding (might need manual check)"
  echo "  Try: curl http://localhost:3000/api/dv/webhook"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  INSTALLATION COMPLETE!"
echo "═══════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "1. Go to https://eigenwebsite.dv.nl → Status → Instellingen"
echo "2. Set URL Endpoint: https://transfer4cars.com/api/dv/webhook"
echo "3. Set Foto afmetingen: 1024x768 (or max)"
echo "4. Click 'Opslaan'"
echo "5. In UCC: activate 'eigen website' portal"
echo "6. Select vehicles for 'eigen website'"
echo ""
echo "Test command:"
echo '  curl -u transfer4:c5eLtlGy! -X POST -H "Content-Type: text/xml" -d "<voertuig actie=\"add\"><voertuignr_hexon>TEST001</voertuignr_hexon><kenteken>AB123CD</kenteken><merk>BMW</merk><model>3 Serie</model><type>320i</type><bouwjaar>2022</bouwjaar><verkoopprijs_particulier><prijzen land=\"nl\"><prijs><bedrag>35000</bedrag><munteenheid>EUR</munteenheid><btw>in</btw><btw_percentage>21</btw_percentage><bpm>n</bpm></prijs></prijzen></verkoopprijs_particulier></voertuig>" https://transfer4cars.com/api/dv/webhook'
echo ""
