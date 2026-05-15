#!/bin/bash
# Gebruik dit ALTIJD ipv pm2 start
RUNNING=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json;print(sum(1 for p in json.load(sys.stdin) if p.get('name')=='t4c-server'))" 2>/dev/null)
if [ "$RUNNING" -ge "1" ]; then
  echo "t4c-server draait al — doe: pm2 restart t4c-server --update-env"
  exit 1
fi
cd /opt/t4c && pm2 start backend/server.js --name t4c-server --update-env
pm2 save
