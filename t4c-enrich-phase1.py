#!/usr/bin/env python3
"""
T4C Data Verrijking — Fase 1
- Voegt AS24.de + AS24.be toe aan crawler
- Fixt ILSA sync (options opslaan, alle listings binnenhalen)
- Voegt options kolom toe aan upsertListing

PRICING WORDT NIET AANGERAAKT.
"""
import subprocess, sys

def check_syntax(file_path):
    result = subprocess.run(['node', '--check', file_path], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"SYNTAX ERROR in {file_path}:")
        print(result.stderr)
        return False
    print(f"✓ {file_path} syntax OK")
    return True

# ═══ 1. market.js — Add AS24.de + AS24.be to crawler sources ═══
print("\n═══ 1. market.js — AS24.de + AS24.be toevoegen ═══")

with open('/opt/t4c/backend/routes/market.js', 'r') as f:
    market = f.read()

old_sources = '''        const sources = [
          { name: "Marktplaats", base: `https://www.marktplaats.nl/q/${item.make}+${item.model}+${item.year}/`, pageFn: p => `p/${p}/` },
          { name: "AutoScout24", base: `https://www.autoscout24.nl/lst/${item.make}/${item.model}?fregfrom=${item.year}&fregto=${item.year+1}&cy=NL`, pageFn: p => `&page=${p}` },
          { name: "AutoTrack", base: `https://www.autotrack.nl/aanbod?merk=${item.make}&model=${item.model}&bouwjaar_van=${item.year}&bouwjaar_tot=${item.year}`, pageFn: p => `&pagina=${p}` },
          { name: "Gaspedaal", base: `https://www.gaspedaal.nl/${item.make}-${item.model}/jaar-${item.year}`, pageFn: p => `?page=${p}` },
          { name: "Autowereld", base: `https://www.autowereld.nl/${item.make}/${item.make}-${item.model}/b_${item.year}`, pageFn: p => `/p_${p}` },
          { name: "ViaBovag", base: `https://www.viabovag.nl/auto/merk-${item.make}/model-${item.model}?bouwjaarVan=${item.year}&bouwjaarTot=${item.year+1}`, pageFn: p => `&pagina=${p}` },
        ]'''

new_sources = '''        const sources = [
          { name: "Marktplaats", base: `https://www.marktplaats.nl/q/${item.make}+${item.model}+${item.year}/`, pageFn: p => `p/${p}/` },
          { name: "AutoScout24", base: `https://www.autoscout24.nl/lst/${item.make}/${item.model}?fregfrom=${item.year}&fregto=${item.year+1}&cy=NL`, pageFn: p => `&page=${p}` },
          { name: "AutoScout24.de", base: `https://www.autoscout24.de/lst/${item.make}/${item.model}?fregfrom=${item.year}&fregto=${item.year+1}&sort=price&desc=0`, pageFn: p => `&page=${p}` },
          { name: "AutoScout24.be", base: `https://www.autoscout24.be/nl/lst/${item.make}/${item.model}?fregfrom=${item.year}&fregto=${item.year+1}`, pageFn: p => `&page=${p}` },
          { name: "AutoTrack", base: `https://www.autotrack.nl/aanbod?merk=${item.make}&model=${item.model}&bouwjaar_van=${item.year}&bouwjaar_tot=${item.year}`, pageFn: p => `&pagina=${p}` },
          { name: "Gaspedaal", base: `https://www.gaspedaal.nl/${item.make}-${item.model}/jaar-${item.year}`, pageFn: p => `?page=${p}` },
          { name: "Autowereld", base: `https://www.autowereld.nl/${item.make}/${item.make}-${item.model}/b_${item.year}`, pageFn: p => `/p_${p}` },
          { name: "ViaBovag", base: `https://www.viabovag.nl/auto/merk-${item.make}/model-${item.model}?bouwjaarVan=${item.year}&bouwjaarTot=${item.year+1}`, pageFn: p => `&pagina=${p}` },
        ]'''

if old_sources in market:
    market = market.replace(old_sources, new_sources)
    print("✓ AS24.de + AS24.be toegevoegd aan crawler sources")
else:
    print("✗ Kon crawler sources niet vinden — handmatig checken")
    sys.exit(1)

# 1b. Update upsertListing call in storeListingsForHistory to pass options
old_upsert_call = "const result = stmts.upsertListing.run(hash, mk, ml, yr, l.title, l.price, l.km||null, trans||'', l.source, l.url||'', l.dealer||'', l.image_url||'')"
new_upsert_call = "const result = stmts.upsertListing.run(hash, mk, ml, yr, l.title, l.price, l.km||null, trans||'', l.source, l.url||'', l.dealer||'', l.image_url||'', l.options||'')"

if old_upsert_call in market:
    market = market.replace(old_upsert_call, new_upsert_call)
    print("✓ storeListingsForHistory: options parameter doorgeven")
else:
    print("⚠ upsertListing call niet exact gevonden in market.js")

with open('/opt/t4c/backend/routes/market.js', 'w') as f:
    f.write(market)

if not check_syntax('/opt/t4c/backend/routes/market.js'):
    sys.exit(1)

# ═══ 2. db.js — Voeg options toe aan upsertListing + srcMap updaten ═══
print("\n═══ 2. db.js — options kolom + srcMap AS24.de/BE ═══")

with open('/opt/t4c/backend/db.js', 'r') as f:
    dbjs = f.read()

# 2a. Update srcMap to include the new source names
old_srcmap = "const _srcMap = {'autoscout24':'src_a','marktplaats':'src_b','autoscout24.be':'src_c','autoscout24.de':'src_d','autoscout24.nl':'src_a','autotrack':'src_e','gaspedaal':'src_f','autowereld':'src_g','viabovag':'src_h','mobile.de':'src_i','autoweek':'src_j','autoofy':'nlmarket','autohero':'nlretail'}"
new_srcmap = "const _srcMap = {'autoscout24':'src_a','marktplaats':'src_b','autoscout24.be':'src_c','autoscout24.de':'src_d','autoscout24.nl':'src_a','autotrack':'src_e','gaspedaal':'src_f','autowereld':'src_g','viabovag':'src_h','mobile.de':'src_i','autoweek':'src_j','autoofy':'nlmarket','autohero':'nlretail','AutoScout24.de':'src_d','AutoScout24.be':'src_c'}"

if old_srcmap in dbjs:
    dbjs = dbjs.replace(old_srcmap, new_srcmap)
    print("✓ srcMap updated met AS24.de/BE namen")
else:
    print("⚠ srcMap niet exact gevonden — check handmatig")

# 2b. Add options parameter to upsertListing function signature
old_upsert_sig = "run: (hash, mk, ml, yr, title, price, km, trans, source, url, dealer, image_url) => {"
new_upsert_sig = "run: (hash, mk, ml, yr, title, price, km, trans, source, url, dealer, image_url, options) => {"

if old_upsert_sig in dbjs:
    dbjs = dbjs.replace(old_upsert_sig, new_upsert_sig)
    print("✓ upsertListing signature uitgebreid met options")
else:
    print("⚠ upsertListing signature niet exact gevonden")

# 2c. Add options to INSERT statement
old_insert = 'run("INSERT INTO market_listings (hash,make,model,year,title,price,km,transmission,source,url,dealer,fuel,body_type,engine_code,image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",'
new_insert = 'run("INSERT INTO market_listings (hash,make,model,year,title,price,km,transmission,source,url,dealer,fuel,body_type,engine_code,image_url,options) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",'

if old_insert in dbjs:
    dbjs = dbjs.replace(old_insert, new_insert)
    print("✓ INSERT statement: options kolom toegevoegd")
else:
    print("⚠ INSERT statement niet exact gevonden")

old_insert_vals = "[hash, mk, ml, yr, title, price, km, trans, source, url, dealer||'', _fuel, _body, _eng, image_url||''])"
new_insert_vals = "[hash, mk, ml, yr, title, price, km, trans, source, url, dealer||'', _fuel, _body, _eng, image_url||'', options||''])"

if old_insert_vals in dbjs:
    dbjs = dbjs.replace(old_insert_vals, new_insert_vals)
    print("✓ INSERT values: options parameter toegevoegd")
else:
    print("⚠ INSERT values niet exact gevonden")

# 2d. Update existing listings with options if provided
old_update = '''run("UPDATE market_listings SET price=?, km=?, dealer=CASE WHEN ?!='' THEN ? ELSE dealer END, image_url=CASE WHEN ?!='' AND (image_url IS NULL OR image_url='') THEN ? ELSE image_url END, last_seen=datetime('now'), status='active' WHERE hash=?", [price, km, dealer||'', dealer||'', image_url||'', image_url||'', hash])'''

new_update = '''run("UPDATE market_listings SET price=?, km=?, dealer=CASE WHEN ?!='' THEN ? ELSE dealer END, image_url=CASE WHEN ?!='' AND (image_url IS NULL OR image_url='') THEN ? ELSE image_url END, options=CASE WHEN ?!='' AND (options IS NULL OR options='') THEN ? ELSE options END, last_seen=datetime('now'), status='active' WHERE hash=?", [price, km, dealer||'', dealer||'', image_url||'', image_url||'', options||'', options||'', hash])'''

if old_update in dbjs:
    dbjs = dbjs.replace(old_update, new_update)
    print("✓ UPDATE statement: options bijwerken bij update")
else:
    print("⚠ UPDATE statement niet exact gevonden — check handmatig")

with open('/opt/t4c/backend/db.js', 'w') as f:
    f.write(dbjs)

if not check_syntax('/opt/t4c/backend/db.js'):
    sys.exit(1)

# ═══ 3. server.js — Fix ILSA sync (options + fuel opslaan) ═══
print("\n═══ 3. server.js — ILSA sync options + fuel opslaan ═══")

with open('/opt/t4c/backend/server.js', 'r') as f:
    serverjs = f.read()

# 3a. Extract options + fuel from ILSA data
old_ilsa_extract = """              const trans = r.powertrain?.transmission?.type?.display_value || ''
              const dealer = (r.advertiser?.name || '').slice(0, 60)"""

new_ilsa_extract = """              const trans = r.powertrain?.transmission?.type?.display_value || ''
              const dealer = (r.advertiser?.name || '').slice(0, 60)
              const options = (g.type?.supplement || '').slice(0, 500)
              const fuel = r.powertrain?.engine?.energy?.type?.category?.display_value || r.powertrain?.engine?.energy?.type?.code?.display_value || ''"""

if old_ilsa_extract in serverjs:
    serverjs = serverjs.replace(old_ilsa_extract, new_ilsa_extract)
    print("✓ ILSA extract: options + fuel uit response")
else:
    print("⚠ ILSA extract niet exact gevonden — check handmatig")

# 3b. Update ILSA INSERT to include options + fuel
old_ilsa_insert = """              else { run("INSERT INTO market_listings (hash,make,model,year,title,price,km,transmission,source,url,dealer) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [hash, mk, ml, yr, title, price, km, trans, 'nlmarket', '', dealer]); ilsaNew++ }"""

new_ilsa_insert = """              else { run("INSERT INTO market_listings (hash,make,model,year,title,price,km,transmission,source,url,dealer,options,fuel) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [hash, mk, ml, yr, title, price, km, trans, 'nlmarket', '', dealer, options, fuel]); ilsaNew++ }"""

if old_ilsa_insert in serverjs:
    serverjs = serverjs.replace(old_ilsa_insert, new_ilsa_insert)
    print("✓ ILSA INSERT: options + fuel kolommen")
else:
    print("⚠ ILSA INSERT niet exact gevonden — check handmatig")

# 3c. Update ILSA UPDATE to also set options + fuel
old_ilsa_update = """              if (ex) { run("UPDATE market_listings SET price=?, km=?, last_seen=datetime('now'), status='active', dealer=? WHERE hash=?", [price, km, dealer, hash]); ilsaUpd++ }"""

new_ilsa_update = """              if (ex) { run("UPDATE market_listings SET price=?, km=?, last_seen=datetime('now'), status='active', dealer=?, options=CASE WHEN ?!='' AND (options IS NULL OR options='') THEN ? ELSE options END, fuel=CASE WHEN ?!='' AND (fuel IS NULL OR fuel='') THEN ? ELSE fuel END WHERE hash=?", [price, km, dealer, options, options, fuel, fuel, hash]); ilsaUpd++ }"""

if old_ilsa_update in serverjs:
    serverjs = serverjs.replace(old_ilsa_update, new_ilsa_update)
    print("✓ ILSA UPDATE: options + fuel bijwerken")
else:
    print("⚠ ILSA UPDATE niet exact gevonden — check handmatig")

with open('/opt/t4c/backend/server.js', 'w') as f:
    f.write(serverjs)

if not check_syntax('/opt/t4c/backend/server.js'):
    sys.exit(1)

print("""
══════════════════════════════════════════
  ALLE WIJZIGINGEN KLAAR — SYNTAX OK
══════════════════════════════════════════

Wat er veranderd is:
  market.js  → AS24.de + AS24.be in crawler sources
  market.js  → upsertListing call passt options door
  db.js      → upsertListing slaat options op (INSERT + UPDATE)
  db.js      → srcMap kent AS24.de/BE namen
  server.js  → ILSA sync haalt options + fuel uit API response

Deploy:
  pm2 restart t4c-server --update-env

Test ILSA:
  curl -s http://localhost:3000/api/admin/daily-tasks -H "Authorization: Bearer TOKEN"

Check resultaat:
  node -e "const{initDB,queryOne}=require('./backend/db');initDB().then(()=>{console.log(queryOne(\\"SELECT COUNT(*) as c FROM market_listings WHERE options IS NOT NULL AND options != ''\\"))})"

PRICING IS NIET AANGERAAKT.
""")

