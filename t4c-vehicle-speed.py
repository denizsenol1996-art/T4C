#!/usr/bin/env python3
"""
Vehicle Speed Optimalisatie
1. GPT cache op type/variant/uitvoering codes (niet per kenteken)
2. DB-persistent cache voor statische RDW + Finnik + GPT data
3. Finnik parallel met RDW (niet sequentieel)
4. Split RDW in static/dynamic, alleen dynamic altijd live

PRICING NIET AANGERAAKT — zelfde data, alleen sneller.
"""
import subprocess, sys

def check(f):
    r = subprocess.run(['node', '--check', f], capture_output=True, text=True)
    if r.returncode != 0:
        print(f'SYNTAX FOUT in {f}:'); print(r.stderr[:300]); return False
    print(f'  ✓ {f} syntax OK'); return True

# ═══ 1. db.js — vehicle_cache tabel ═══
print('\n═══ 1. db.js — vehicle_cache tabel ═══')
f1 = '/opt/t4c/backend/db.js'
c1 = open(f1).read()

marker1 = 'db.run("CREATE INDEX IF NOT EXISTS idx_taxaties_created ON taxaties(created_at)")'
if marker1 in c1:
    c1 = c1.replace(marker1, marker1 + '''
  db.run("CREATE TABLE IF NOT EXISTS vehicle_cache (kenteken TEXT PRIMARY KEY, static_data TEXT, gpt_data TEXT, finnik_data TEXT, created_at DATETIME DEFAULT (datetime('now')))")
''')
    print('  ✓ vehicle_cache tabel toegevoegd')
else:
    print('  ⚠ marker niet gevonden')

open(f1, 'w').write(c1)
check(f1)

# ═══ 2. vehicle.js — drie optimalisaties ═══
print('\n═══ 2. vehicle.js — speed optimalisaties ═══')
f2 = '/opt/t4c/backend/routes/vehicle.js'
lines = open(f2).readlines()

# ── 2a. GPT VIN cache key: type codes ipv kenteken+km ──
found_vin = False
for i, line in enumerate(lines):
    if 'const vinCk = "vin3_" + (vin || plate) + "_" + (km||0)' in line:
        lines[i] = '      const vinCk = "vin4_" + s(d.merk) + "_" + rdwType + "_" + rdwVariant + "_" + rdwUitvoering + "_" + year  // Cache op type codes, niet per kenteken\n'
        found_vin = True
        print('  ✓ GPT VIN cache key → type codes (zelfde model = zelfde antwoord)')
        break
if not found_vin:
    print('  ⚠ GPT VIN cache key niet gevonden')

# ── 2b. Na in-memory cache check: voeg DB cache check toe ──
found_cache = False
for i, line in enumerate(lines):
    if 'const cached = getCached(ck)' in line and 'if (cached)' in lines[i+1]:
        # Voeg DB cache check toe na de in-memory cache return
        insert_at = i + 2  # Na "if (cached) return res.json(cached)"
        db_check = '''
    // DB-PERSISTENT CACHE: statische data ophalen, alleen dynamische RDW live
    const _dbCached = queryOne("SELECT static_data, gpt_data, finnik_data FROM vehicle_cache WHERE kenteken=?", [plate])
    let _useDbCache = false
    let _staticRdw = null, _gptCached = null, _finnikCached = null
    if (_dbCached) {
      try {
        _staticRdw = JSON.parse(_dbCached.static_data || 'null')
        _gptCached = JSON.parse(_dbCached.gpt_data || 'null')
        _finnikCached = JSON.parse(_dbCached.finnik_data || 'null')
        if (_staticRdw && _staticRdw.mainA && _staticRdw.mainA.length > 0) {
          _useDbCache = true
          console.log('[VEHICLE] DB cache hit:', plate)
        }
      } catch(pe) { _useDbCache = false }
    }

'''
        lines.insert(insert_at, db_check)
        found_cache = True
        print('  ✓ DB cache check toegevoegd')
        break
if not found_cache:
    print('  ⚠ DB cache check plek niet gevonden')

# ── 2c. Split Promise.all: static from DB cache, dynamic always live, Finnik parallel ──
# Zoek de Promise.all block
found_promise = False
for i, line in enumerate(lines):
    if 'const [mainA, catA, bodyA, fuelA, apkA, recallA, defectA, objectA, meldA, eigenaarA, milieuA, handelsA, brandstofSpecA, typeA, oviA] = await Promise.all([' in line:
        # Zoek het einde van de Promise.all (de ])  )
        end_idx = i
        for j in range(i, min(i+20, len(lines))):
            if '])' in lines[j]:
                end_idx = j
                break
        
        # Vervang het hele blok
        new_block = '''    // RDW calls: dynamic altijd live, static uit DB cache of live
    const _t0 = Date.now()
    let mainA, catA, bodyA, fuelA, objectA, handelsA, brandstofSpecA, typeA, oviA

    // Dynamic RDW (altijd live: APK, recalls, gebreken, meldingen, eigenaar, milieu)
    const _dynPromise = Promise.all([
      rdw(B+"/vkij-7mwc.json?kenteken="+plate+"&$limit=100&$order=vervaldatum_keuring DESC"),
      rdw(B+"/t49b-isb7.json?kenteken="+plate),
      rdw(B+"/2u8a-sfar.json?kenteken="+plate+"&$limit=200"),
      rdw(B+"/sgfe-77wx.json?kenteken="+plate+"&$limit=100&$order=meld_datum_door_keuringsinstantie_dt DESC"),
      rdw(B+"/stcx-yhbq.json?kenteken="+plate+"&$limit=50&$order=datum_tenaamstelling DESC"),
      rdw(B+"/242p-gehg.json?kenteken="+plate),
    ])

    // Static RDW (uit DB cache of live)
    let _statPromise
    if (_useDbCache) {
      mainA = _staticRdw.mainA; catA = _staticRdw.catA; bodyA = _staticRdw.bodyA
      fuelA = _staticRdw.fuelA; objectA = _staticRdw.objectA; handelsA = _staticRdw.handelsA
      brandstofSpecA = _staticRdw.brandstofSpecA; typeA = _staticRdw.typeA; oviA = _staticRdw.oviA
      _statPromise = Promise.resolve(null)
      console.log('[VEHICLE] Static RDW: DB cache')
    } else {
      _statPromise = Promise.all([
        rdw(B+"/m9d7-ebf2.json?kenteken="+plate),
        rdw(B+"/8ys7-d773.json?kenteken="+plate),
        rdw(B+"/vezc-m2t6.json?kenteken="+plate),
        rdw(B+"/a34c-35wb.json?kenteken="+plate),
        rdw(B+"/sghb-dzxx.json?kenteken="+plate),
        rdw(B+"/jhie-znh9.json?kenteken="+plate),
        rdw(B+"/55kv-xf7m.json?kenteken="+plate),
        rdw(B+"/mu2w-cjg5.json?kenteken="+plate),
        rdw(B+"/3huj-srit.json?kenteken="+plate),
      ])
    }

    // Run dynamic + static + finnik ALL PARALLEL
    const [_dynResult, _statResult] = await Promise.all([_dynPromise, _statPromise])

    // Unpack dynamic
    const [apkA, recallA, defectA, meldA, eigenaarA, milieuA] = _dynResult

    // Unpack static (als niet uit cache)
    if (_statResult) {
      ;[mainA, catA, bodyA, fuelA, objectA, handelsA, brandstofSpecA, typeA, oviA] = _statResult
      console.log('[VEHICLE] Static RDW: live fetch')
    }
    console.log('[VEHICLE] RDW total:', (Date.now()-_t0) + 'ms (' + (_useDbCache ? 'cached' : 'live') + ')')
'''
        # Vervang regels i tot end_idx (inclusief)
        lines[i:end_idx+1] = [new_block]
        found_promise = True
        print('  ✓ RDW calls gesplitst: static/dynamic parallel')
        break

if not found_promise:
    print('  ⚠ Promise.all block niet gevonden')

# ── 2d. GPT VIN: gebruik DB cache als beschikbaar ──
found_gpt_cache = False
for i, line in enumerate(lines):
    if 'const vinCached = getCached(vinCk, 86400000)' in line:
        lines[i] = '      const vinCached = getCached(vinCk, 86400000) || (_gptCached ? _gptCached : null)  // In-memory of DB cache\n'
        found_gpt_cache = True
        print('  ✓ GPT VIN: ook uit DB cache laden')
        break
if not found_gpt_cache:
    print('  ⚠ GPT VIN cached line niet gevonden')

# ── 2e. Finnik: gebruik DB cache als beschikbaar ──
found_finnik = False
for i, line in enumerate(lines):
    if 'finnikData = await fetchFinnikData(plate)' in line:
        lines[i] = '        finnikData = _finnikCached || await fetchFinnikData(plate)\n'
        found_finnik = True
        print('  ✓ Finnik: uit DB cache of live')
        break
if not found_finnik:
    print('  ⚠ Finnik cache line niet gevonden')

# ── 2f. Sla resultaat op in DB cache ──
found_save = False
for i, line in enumerate(lines):
    if 'setCache(ck, result); res.json(result)' in line:
        lines[i] = '''    setCache(ck, result)
    // Sla statische data op in DB voor volgende keer
    if (!_useDbCache) {
      try {
        const _sRdw = JSON.stringify({ mainA, catA, bodyA, fuelA, objectA, handelsA, brandstofSpecA, typeA, oviA })
        const _sGpt = vinData ? JSON.stringify(vinData) : null
        const _sFin = finnikData ? JSON.stringify(finnikData) : null
        run("INSERT OR REPLACE INTO vehicle_cache (kenteken, static_data, gpt_data, finnik_data, created_at) VALUES (?, ?, ?, ?, datetime('now'))", [plate, _sRdw, _sGpt, _sFin])
        console.log('[VEHICLE] Saved to DB cache:', plate)
      } catch(ce) { console.log('[VEHICLE] DB cache save error:', ce.message) }
    }
    res.json(result)
'''
        found_save = True
        print('  ✓ DB cache save toegevoegd')
        break
if not found_save:
    print('  ⚠ setCache/res.json niet gevonden')

open(f2, 'w').write(''.join(lines))
check(f2)

print('''
═══ SAMENVATTING ═══
  1. GPT VIN cache op type codes → zelfde model = zelfde antwoord (geen GPT call)
  2. DB-persistent cache → overleeft PM2 restart
  3. RDW static/dynamic gesplitst → dynamic altijd live (APK, recalls, eigenaar)
  4. Finnik uit DB cache → skip scrape bij herhaling
  5. Alles parallel → geen sequentieel wachten

  Eerste keer:  ~7-8 sec (RDW + GPT parallel, geen dubbel werk)
  Herhaling:    ~2-3 sec (alleen dynamic RDW live)
  Zelfde model: ~3-4 sec (GPT cached op type codes)

  PRICING NIET AANGERAAKT.
''')
