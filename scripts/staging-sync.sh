#!/usr/bin/env bash
# T4C staging code-sync — kopieer /opt/t4c/backend/ naar staging.
#
# Gebruik: handmatig wanneer code-versie van staging gelijk moet zijn aan prod.
# Voor RSPP-cyclus: maak na sync de gewenste wijziging in staging,
# golden-replay tegen prod-baseline, beslis.

set -euo pipefail

SRC="/opt/t4c/backend"
DST="/home/deniz/t4c-staging/backend"

if [ ! -d "$SRC" ]; then
  echo "❌ Bron ontbreekt: $SRC" >&2
  exit 1
fi

# Bewaar staging-eigen wijzigingen (RSPP-in-progress) in een snap
if [ -d "$DST" ]; then
  STAMP=$(date +%Y%m%d_%H%M)
  SNAP="/home/deniz/t4c-staging/backend.snap-$STAMP"
  cp -r "$DST" "$SNAP"
  echo "Eerdere backend opgeslagen: $SNAP"
fi

# Sync (gebruik rsync voor snelheid + uitzondering van node_modules)
rsync -a --delete \
  --exclude='node_modules/' \
  --exclude='*.bak-*' \
  --exclude='*.WORKING-*' \
  "$SRC/" "$DST/"

# Symlink node_modules (zelfde npm-tree, scheelt 230MB)
if [ ! -L "$DST/node_modules" ]; then
  rm -rf "$DST/node_modules" 2>/dev/null || true
  ln -s "$SRC/node_modules" "$DST/node_modules"
fi

# Symlink ook root node_modules (helmet etc.)
if [ ! -L "/home/deniz/t4c-staging/node_modules" ]; then
  rm -rf "/home/deniz/t4c-staging/node_modules" 2>/dev/null || true
  ln -s "/opt/t4c/node_modules" "/home/deniz/t4c-staging/node_modules"
fi

# .env symlink (zelfde keys + DB-pad-override gaat via ecosystem env)
if [ ! -L "$DST/.env" ]; then
  rm -f "$DST/.env" 2>/dev/null
  ln -s "/opt/t4c/backend/.env" "$DST/.env"
fi
# .env in staging cwd voor dotenv-resolve
if [ ! -L "/home/deniz/t4c-staging/.env" ]; then
  ln -sf "/opt/t4c/backend/.env" "/home/deniz/t4c-staging/.env"
fi

echo "✅ Staging backend gesynchroniseerd vanuit $SRC"
