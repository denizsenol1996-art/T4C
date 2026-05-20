#!/bin/bash
# Veilige restart: forceSave VOOR restart
cd /opt/t4c
echo "Saving database to disk..."
node -e "require('./backend/db').initDB().then(()=>{require('./backend/db').forceSave();console.log('DB SAVED');process.exit()})"
echo "[SAFE-RESTART] Ensuring backend deps installed..."
cd /opt/t4c/backend && npm install --omit=dev --silent || {
  echo "[SAFE-RESTART] npm install failed — abort"; exit 1;
}
echo "Restarting PM2..."
pm2 restart t4c-server --update-env
echo "Done."
