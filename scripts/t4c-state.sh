#!/bin/bash
# T4C/CarDataX LIVE STATE — read-only momentopname van ALLES. Draai aan begin van elke sessie.
# Gebruik: bash /opt/t4c/scripts/t4c-state.sh   (optioneel > /opt/t4c/data/STATE-$(date +%F).txt)
NODE=/opt/t4c/backend/node_modules/better-sqlite3
PGDEV=c0s4wo440g4sowsksocg0s04
echo "==================== T4C STATE @ $(date -u +'%Y-%m-%d %H:%M UTC') ===================="
echo "### SERVICES (pm2)"; pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{JSON.parse(d).forEach(p=>console.log("  "+p.name.padEnd(20)+p.pm2_env.status+" | restarts "+p.pm2_env.restart_time))}catch(e){console.log("  (pm2 parse faalde)")}})'
echo "### DOCKER"; docker ps --format "  {{.Names}}  {{.Status}}" 2>/dev/null | grep -iE "cardatax|app-|postgres|redis" | head
echo "### GIT"
cd /opt/t4c && echo "  t4c: $(git branch --show-current) | uncommitted: $(git status --porcelain|wc -l)"
cd /opt/cardatax-app/dev && git fetch -q origin 2>/dev/null; echo "  cardatax-dev: $(git branch --show-current) | voor op origin: $(git rev-list origin/dev..HEAD --count 2>/dev/null) | uncommitted: $(git status --porcelain|wc -l)"
echo "### DATABASES — t4c.db tabellen (rijen)"
node -e "const D=require(process.argv[1]);const db=new D('/opt/t4c/data/t4c.db',{readonly:true});for(const t of db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(x=>x.name)){try{const n=db.prepare('SELECT COUNT(*) n FROM '+t).get().n;if(n>0)console.log('  '+t.padEnd(26)+n)}catch(e){}}" "$NODE"
echo "### DATA-GEZONDHEID (dupes/clutter — de waakhond)"
node -e "const D=require(process.argv[1]);const db=new D('/opt/t4c/data/t4c.db',{readonly:true});
const ml=db.prepare('SELECT COUNT(*) n FROM market_listings').get().n;
const tx=db.prepare(\"SELECT COUNT(*) t,COUNT(DISTINCT kenteken) u FROM taxaties WHERE kenteken IS NOT NULL AND kenteken!=''\").get();
console.log('  t4c.db market_listings:    '+ml);
console.log('  taxaties dupes:            '+tx.t+' rijen / '+tx.u+' uniek = '+(tx.t-tx.u)+' dubbel');
for(const t of ['voorraad','voorraad_tmp','dv_vehicles']){const n=db.prepare('SELECT COUNT(*) n FROM '+t).get().n;console.log('  inventaris '+t.padEnd(14)+n)}" "$NODE"
echo "### Postgres (cardatax_dev) markt + dedup"
docker exec $PGDEV psql -U cardatax -d cardatax_dev -t -c "SELECT '  market_listings: '||COUNT(*)||' | uniek dedup_key: '||COUNT(DISTINCT dedup_key)||' | DUBBEL: '||(COUNT(*)-COUNT(DISTINCT dedup_key)) FROM market_listings; SELECT '  vers <24u: '||COUNT(*) FROM market_listings WHERE last_seen>now()-interval '24 hours';" 2>/dev/null
echo "### GROUND-TRUTH stores"
node -e "const D=require(process.argv[1]);for(const [nm,p] of [['ground_truth','/opt/t4c/data/groundtruth/ground_truth.db'],['auto1','/opt/t4c/data/groundtruth/auto1_purchases.db']]){try{const db=new D(p,{readonly:true});const t=db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' LIMIT 1\").get().name;console.log('  '+nm+': '+db.prepare('SELECT COUNT(*) n FROM '+t).get().n+' rijen')}catch(e){console.log('  '+nm+': n/b')}}" "$NODE"
echo "==================== EINDE STATE ===================="
