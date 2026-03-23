// T4C Veiling Routes — Sessie 4: Compleet veilingsysteem
const express = require("express")
const router = express.Router()
const { stmts, queryAll, queryOne, run } = require("../db")
const { authMiddleware, adminOnly, staffOnly } = require("../lib/auth")
const { writeLog } = require("../lib/state")

/* ═══════════════════════════════════════════════
   VEILING LIFECYCLE — Auto-check elke 60 seconden
   ═══════════════════════════════════════════════ */

function checkVeilingen() {
  try {
    const geplande = queryAll("SELECT * FROM veilingen WHERE status='gepland' AND start_datum <= datetime('now')")
    for (const v of geplande) {
      run("UPDATE veilingen SET status='actief', updated_at=datetime('now') WHERE id=?", [v.id])
      if (v.voorraad_id) run("UPDATE voorraad SET status='in_veiling', updated_at=datetime('now') WHERE id=?", [v.voorraad_id])
      writeLog("server.log", "VEILING #" + v.id + " GEACTIVEERD (was gepland)")
    }
    const verlopen = stmts.getVerlopenVeilingen.all()
    for (const v of verlopen) {
      const hoogste = stmts.getHoogsteBod.get(v.id)
      if (hoogste && hoogste.bedrag >= v.minimumprijs) {
        run("UPDATE veilingen SET status='gewonnen', winnaar_user_id=?, winnaar_bod=?, updated_at=datetime('now') WHERE id=?", [hoogste.user_id, hoogste.bedrag, v.id])
        if (v.voorraad_id) run("UPDATE voorraad SET status='verkocht', updated_at=datetime('now') WHERE id=?", [v.voorraad_id])
        try {
          const winnaar = queryOne("SELECT * FROM users WHERE id=?", [hoogste.user_id])
          const car = v.voorraad_id ? queryOne("SELECT * FROM voorraad WHERE id=?", [v.voorraad_id]) : null
          const portfolio = v.kenteken ? queryOne("SELECT * FROM portfolio WHERE kenteken=? ORDER BY id DESC LIMIT 1", [v.kenteken]) : null
          const inkoop = portfolio?.inkoop_prijs || 0, reconditie = portfolio?.reconditie_kosten || 0
          stmts.addVerkoop.run({ kenteken: v.kenteken, make: car?.make||v.merk||"", model: car?.model||v.model||"", year: car?.year||v.bouwjaar, type: "veiling", inkoop_prijs: inkoop, verkoop_prijs: hoogste.bedrag, reconditie, marge: hoogste.bedrag-inkoop-reconditie, koper_naam: winnaar?.username||hoogste.username||"", koper_email: winnaar?.email||"", koper_id: hoogste.user_id, veiling_id: v.id, portfolio_id: portfolio?.id||null, voorraad_id: v.voorraad_id, notities: "Veiling #"+v.id+" ronde "+(v.ronde||1) })
          try { generateFactuur(v, hoogste, winnaar, car) } catch(fe) { writeLog("errors.log", "FACTUUR ERROR #"+v.id+": "+fe.message) }
          if (winnaar?.email) stmts.addEmailQueue.run({ to_email: winnaar.email, subject: "Veiling #"+v.id+" gewonnen!", body: "Gefeliciteerd! Je hebt "+((v.merk||"")+" "+(v.model||"")).trim()+" gewonnen voor EUR "+hoogste.bedrag+". Log in om transport te kiezen en af te rekenen.", type: 'veiling_gewonnen' })
        } catch(e) { writeLog("errors.log", "VERKOOP ERROR #"+v.id+": "+e.message) }
        writeLog("server.log", "VEILING #"+v.id+" GEWONNEN user "+hoogste.user_id+" EUR "+hoogste.bedrag)
      } else {
        stmts.archiveBids.run(v.id, v.ronde||1)
        const nieuweEind = new Date(Date.now()+24*60*60*1000).toISOString()
        run("UPDATE veilingen SET status='actief', ronde=?, eind_datum=?, huidige_bod=0, aantal_biedingen=0, updated_at=datetime('now') WHERE id=?", [(v.ronde||1)+1, nieuweEind, v.id])
        run("DELETE FROM veiling_biedingen WHERE veiling_id=?", [v.id])
        writeLog("server.log", "VEILING #"+v.id+" HERSTART ronde "+((v.ronde||1)+1))
        try { const ws=stmts.getWatchers.all(v.id); for(const w of ws){ if(w.email) stmts.addEmailQueue.run({to_email:w.email,subject:"Veiling herstart: "+(v.merk||"")+" "+(v.model||""),body:"Minimumbedrag niet bereikt. Bied opnieuw!",type:'veiling_herstart'}) } } catch{}
      }
    }
  } catch(e) { writeLog("errors.log", "VEILING CHECK ERROR: "+e.message) }
}
setInterval(() => { try { checkVeilingen() } catch(e) { console.error("[VEILING]", e.message) } }, 60000)

/* ═══ FACTUUR GENERATIE ═══ */
function generateFactuur(veiling, bod, winnaar, car) {
  const nr = stmts.nextFactuurNr.get()
  const veilingkosten = Math.round(bod.bedrag * 0.025)
  const subtotaal = bod.bedrag + veilingkosten
  stmts.addFactuur.run({ factuur_nr:nr, veiling_id:veiling.id, verkoop_id:null, koper_id:bod.user_id, koper_naam:winnaar?.name||winnaar?.username||bod.username||"", koper_email:winnaar?.email||"", koper_telefoon:winnaar?.phone||"", koper_adres:"",koper_postcode:"",koper_plaats:"",koper_bedrijf:"",koper_kvk:"",koper_btw_nr:"", kenteken:veiling.kenteken, auto_merk:car?.make||veiling.merk||"", auto_model:car?.model||veiling.model||"", auto_bouwjaar:car?.year||veiling.bouwjaar, auto_km:car?.km||veiling.km, auto_brandstof:car?.fuel||veiling.brandstof||"", auto_vin:car?.vin||"", bod_bedrag:bod.bedrag, transport_keuze:null, transport_kosten:0, veilingkosten, subtotaal, btw_percentage:0, btw_bedrag:0, totaal:subtotaal, marge_regeling:true, notities:"Auto-gegenereerd" })
  writeLog("server.log", "FACTUUR "+nr+" aangemaakt veiling #"+veiling.id+" EUR "+subtotaal)
}

/* ═══ PUBLIEKE ROUTES ═══ */
router.get("/api/veilingen", (req, res) => {
  try {
    const status = req.query.status || 'actief'
    let veilingen
    if (status === 'all') veilingen = stmts.getVeilingen.all()
    else if (status === 'actief') veilingen = stmts.getActieveVeilingen.all()
    else veilingen = stmts.getVeilingen.all(status)
    for (const v of veilingen) { if (v.voorraad_id) v.fotos = queryAll("SELECT id, filename FROM car_photos WHERE voorraad_id=? LIMIT 5", [v.voorraad_id]); v.biedingen_count = v.aantal_biedingen||0 }
    res.json({ ok: true, veilingen })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/veiling/:id", (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok: false, error: "Veiling niet gevonden" })
    v.biedingen = stmts.getVeilingBiedingen.all(v.id)
    if (v.voorraad_id) {
      try { const car = stmts.getVoorraadById.get(v.voorraad_id); if(car) v.auto = { id:car.id, kenteken:car.kenteken, make:car.make, model:car.model, model_variant:car.model_variant, year:car.year, fuel:car.fuel, km:car.km, color:car.color, body:car.body, power_kw:car.power_kw, power_hp:car.power_hp, engine_label:car.engine_label, transmission:car.transmission, doors:car.doors, seats:car.seats, vraag_prijs:car.vraag_prijs, beschrijving:car.beschrijving, highlights:car.highlights, apk_until:car.apk_until, vin:car.vin } } catch{}
      v.fotos = queryAll("SELECT id, filename, filename FROM car_photos WHERE voorraad_id=? ORDER BY sort_order, id", [v.voorraad_id])
    }
    if (v.status === 'gewonnen') { const f = stmts.getFactuurByVeiling.get(v.id); if(f) v.factuur = { id:f.id, factuur_nr:f.factuur_nr, totaal:f.totaal, betaal_status:f.betaal_status, transport_kosten:f.transport_kosten, veilingkosten:f.veilingkosten, bod_bedrag:f.bod_bedrag } }
    res.json({ ok: true, veiling: v })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/veilingen/stats", (req, res) => { try { res.json({ ok:true, stats: stmts.countVeilingen.get() }) } catch(e) { res.status(500).json({ ok:false, error:e.message }) } })

/* ═══ BIED ═══ */
router.post("/api/veiling/:id/bied", authMiddleware, express.json(), (req, res) => {
  try {
    const veiling = stmts.getVeiling.get(req.params.id)
    if (!veiling) return res.status(404).json({ ok:false, error:"Veiling niet gevonden" })
    if (veiling.status !== 'actief') return res.status(400).json({ ok:false, error:"Veiling is niet actief" })
    if (new Date(veiling.eind_datum) <= new Date()) return res.status(400).json({ ok:false, error:"Veiling is verlopen" })
    const bedrag = parseFloat(req.body.bedrag)
    if (!bedrag || bedrag <= 0) return res.status(400).json({ ok:false, error:"Ongeldig bedrag" })
    const huidig = veiling.huidige_bod||0, MIN=50
    if (bedrag <= huidig) return res.status(400).json({ ok:false, error:"Bod moet hoger dan EUR "+huidig })
    if (huidig > 0 && (bedrag-huidig) < MIN) return res.status(400).json({ ok:false, error:"Minimum verhoging EUR "+MIN+". Minimaal EUR "+(huidig+MIN) })
    if (bedrag < veiling.minimumprijs) return res.status(400).json({ ok:false, error:"Bod minimaal EUR "+veiling.minimumprijs })
    const laatste = queryOne("SELECT user_id FROM veiling_biedingen WHERE veiling_id=? ORDER BY bedrag DESC LIMIT 1", [veiling.id])
    if (laatste && laatste.user_id === req.userId) return res.status(400).json({ ok:false, error:"Je bent al hoogste bieder" })
    const user = queryOne("SELECT * FROM users WHERE id=?", [req.userId])
    stmts.addVeilingBod.run({ veiling_id:veiling.id, user_id:req.userId, username:user?.username||req.body.naam||"Anoniem", bedrag })
    run("UPDATE veilingen SET huidige_bod=?, aantal_biedingen=?, updated_at=datetime('now') WHERE id=?", [bedrag, (veiling.aantal_biedingen||0)+1, veiling.id])
    // Anti-snipe: verleng 2 min als <2 min resteert
    const rem = new Date(veiling.eind_datum).getTime()-Date.now()
    if (rem < 120000 && rem > 0) { run("UPDATE veilingen SET eind_datum=? WHERE id=?", [new Date(Date.now()+120000).toISOString(), veiling.id]); writeLog("server.log","ANTI-SNIPE #"+veiling.id) }
    writeLog("server.log", "BOD EUR "+bedrag+" veiling #"+veiling.id+" door "+(user?.username||"user-"+req.userId))
    res.json({ ok:true, message:"Bod geplaatst", bedrag, min_volgend:bedrag+MIN })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.post("/api/veiling/watch", authMiddleware, express.json(), (req, res) => { try { const u=queryOne("SELECT * FROM users WHERE id=?",[req.userId]); stmts.addWatcher.run({veiling_id:req.body.veiling_id||0,user_id:req.userId,email:u?.email||req.body.email||""}); res.json({ok:true}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })

/* ═══ TRANSPORT & AFREKENING ═══ */
router.post("/api/veiling/:id/transport", authMiddleware, express.json(), (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (v.winnaar_user_id !== req.userId) return res.status(403).json({ ok:false, error:"Niet de winnaar" })
    const { keuze } = req.body
    let kosten=0, leverdagen=0
    if (keuze==='ophalen') { kosten=0; leverdagen=0 }
    else if (keuze==='transport_standaard') { kosten=249; leverdagen=5 }
    else if (keuze==='transport_express') { kosten=449; leverdagen=2 }
    const leverdatum = leverdagen>0 ? new Date(Date.now()+leverdagen*86400000).toISOString() : null
    run("UPDATE veilingen SET transport_status='gekozen', transport_keuze=?, transport_kosten=?, leverdatum=?, updated_at=datetime('now') WHERE id=?", [keuze, kosten, leverdatum, v.id])
    const f = stmts.getFactuurByVeiling.get(v.id)
    if (f) { const sub=f.bod_bedrag+f.veilingkosten+kosten; stmts.updateFactuur.run(f.id, { transport_keuze:keuze, transport_kosten:kosten, subtotaal:sub, totaal:sub+f.btw_bedrag }); writeLog("server.log","FACTUUR "+f.factuur_nr+" transport "+keuze+" EUR "+kosten) }
    res.json({ ok:true, transport:{ keuze, kosten, leverdagen, leverdatum } })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.post("/api/veiling/:id/afrekening", authMiddleware, express.json(), (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (v.winnaar_user_id !== req.userId) return res.status(403).json({ ok:false, error:"Niet de winnaar" })
    const f = stmts.getFactuurByVeiling.get(v.id)
    if (!f) return res.status(400).json({ ok:false, error:"Factuur niet gevonden" })
    const d = req.body, updates = {}
    if(d.naam) updates.koper_naam=d.naam; if(d.email) updates.koper_email=d.email; if(d.telefoon) updates.koper_telefoon=d.telefoon
    if(d.adres) updates.koper_adres=d.adres; if(d.postcode) updates.koper_postcode=d.postcode; if(d.plaats) updates.koper_plaats=d.plaats
    if(d.bedrijf) updates.koper_bedrijf=d.bedrijf; if(d.kvk) updates.koper_kvk=d.kvk; if(d.btw_nr) updates.koper_btw_nr=d.btw_nr
    if(d.betaal_methode) updates.betaal_methode=d.betaal_methode
    if (d.btw_nr && !d.marge_regeling) { const btw=Math.round(f.subtotaal*0.21); updates.marge_regeling=0; updates.btw_percentage=21; updates.btw_bedrag=btw; updates.totaal=f.subtotaal+btw }
    if (Object.keys(updates).length) stmts.updateFactuur.run(f.id, updates)
    res.json({ ok:true, factuur: stmts.getFactuur.get(f.id) })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.post("/api/veiling/:id/betaal", authMiddleware, express.json(), (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (v.winnaar_user_id !== req.userId && req.userRole !== 'admin') return res.status(403).json({ ok:false, error:"Geen toegang" })
    const f = stmts.getFactuurByVeiling.get(v.id)
    if (!f) return res.status(400).json({ ok:false, error:"Factuur niet gevonden" })
    stmts.updateFactuur.run(f.id, { betaal_status:'betaald', betaal_methode:req.body.methode||'bank_overschrijving', betaal_referentie:req.body.referentie||"T4C-"+Date.now(), betaald_op:new Date().toISOString() })
    if (v.transport_keuze) run("UPDATE veilingen SET transport_status='betaald', updated_at=datetime('now') WHERE id=?", [v.id])
    writeLog("server.log", "BETALING factuur "+f.factuur_nr+" EUR "+f.totaal)
    res.json({ ok:true, message:"Betaling ontvangen", factuur_nr:f.factuur_nr })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

/* ═══ FACTUUR ROUTES ═══ */
router.get("/api/factuur/:id", authMiddleware, (req, res) => {
  try {
    const f = stmts.getFactuur.get(req.params.id)
    if (!f) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (f.koper_id !== req.userId && req.userRole !== 'admin' && req.userRole !== 't4c') return res.status(403).json({ ok:false, error:"Geen toegang" })
    if (f.veiling_id) { const v=stmts.getVeiling.get(f.veiling_id); if(v) f.veiling={id:v.id,titel:v.titel,status:v.status,transport_keuze:v.transport_keuze,transport_status:v.transport_status} }
    res.json({ ok:true, factuur:f })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})
router.get("/api/factuur/nr/:nr", authMiddleware, (req, res) => { try { const f=stmts.getFactuurByNr.get(req.params.nr); if(!f) return res.status(404).json({ok:false,error:"Niet gevonden"}); if(f.koper_id!==req.userId&&req.userRole!=='admin'&&req.userRole!=='t4c') return res.status(403).json({ok:false,error:"Geen toegang"}); res.json({ok:true,factuur:f}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })
router.get("/api/mijn-facturen", authMiddleware, (req, res) => { try { res.json({ok:true, facturen: stmts.getUserFacturen.all(req.userId)}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })

router.get("/api/mijn-veilingen", authMiddleware, (req, res) => {
  try {
    const gewonnen = stmts.getUserGewonnenVeilingen.all(req.userId)
    const biedingen = stmts.getUserVeilingBiedingen.all(req.userId)
    const map = {}
    for (const b of biedingen) { if(!map[b.veiling_id]) map[b.veiling_id]={...b,mijn_hoogste_bod:b.bedrag}; if(b.bedrag>map[b.veiling_id].mijn_hoogste_bod) map[b.veiling_id].mijn_hoogste_bod=b.bedrag }
    const actief=[], verloren=[]
    for (const v of Object.values(map)) { if(v.veiling_status==='actief') actief.push(v); else if(v.veiling_status==='gewonnen'&&v.winnaar_user_id!==req.userId) verloren.push(v) }
    for (const v of gewonnen) {
      if(v.voorraad_id) v.fotos = queryAll("SELECT id, filename FROM car_photos WHERE voorraad_id=? LIMIT 3", [v.voorraad_id])
      const f = stmts.getFactuurByVeiling.get(v.id)
      if(f) v.factuur = { id:f.id, factuur_nr:f.factuur_nr, totaal:f.totaal, betaal_status:f.betaal_status, transport_kosten:f.transport_kosten, veilingkosten:f.veilingkosten, bod_bedrag:f.bod_bedrag }
    }
    res.json({ ok:true, gewonnen, verloren, actief })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

/* ═══ ADMIN/STAFF ═══ */
router.post("/api/veiling", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const d = req.body
    if (!d.minimumprijs) return res.status(400).json({ ok:false, error:"Minimumprijs vereist" })
    let vid = d.voorraad_id?parseInt(d.voorraad_id):null, car=null
    if (vid) { car=stmts.getVoorraadById.get(vid); if(!car) return res.status(400).json({ok:false,error:"Auto niet gevonden"}); d.kenteken=car.kenteken }
    else if (d.kenteken) { car=queryOne("SELECT * FROM voorraad WHERE kenteken=? AND status!='verkocht'",[d.kenteken.toUpperCase()]); if(car) vid=car.id }
    else return res.status(400).json({ ok:false, error:"Kenteken of voorraad_id vereist" })
    const dupF=vid?"voorraad_id":"kenteken", dupV=vid||(d.kenteken||"").toUpperCase()
    const ex = queryOne("SELECT id FROM veilingen WHERE "+dupF+"=? AND status IN ('actief','gepland')", [dupV])
    if (ex) return res.status(400).json({ ok:false, error:"Al in actieve veiling (#"+ex.id+")" })
    const now=new Date(), start=d.start_datum?new Date(d.start_datum):now, eind=d.eind_datum?new Date(d.eind_datum):new Date(start.getTime()+(parseInt(d.duur_uren)||24)*3600000), status=start>now?"gepland":"actief"
    if(car){d.merk=d.merk||car.make||"";d.model=d.model||car.model||"";d.bouwjaar=d.bouwjaar||car.year||null;d.km=d.km||car.km||null;d.brandstof=d.brandstof||car.fuel||"";d.kleur=d.kleur||car.color||""}
    d.titel=d.titel||((d.merk||"")+" "+(d.model||"")+" "+(d.bouwjaar||"")).trim(); d.kenteken=(d.kenteken||"").toUpperCase(); d.start_datum=start.toISOString(); d.eind_datum=eind.toISOString(); d.created_by=req.userId
    stmts.addVeiling.run({...d, voorraad_id:vid, status})
    const id = queryOne("SELECT last_insert_rowid() as id")?.id
    if(vid&&status==="actief") run("UPDATE voorraad SET status='in_veiling', updated_at=datetime('now') WHERE id=?", [vid])
    try{const es=stmts.getAllWatcherEmails.all();for(const e of es)stmts.addEmailQueue.run({to_email:e.email,subject:"Nieuwe veiling: "+d.titel,body:"Nieuwe veiling: "+d.titel+" ("+d.kenteken+"). Min EUR "+d.minimumprijs,type:"nieuwe_veiling"})}catch{}
    writeLog("server.log", "VEILING #"+id+" AANGEMAAKT: "+d.titel+" min EUR "+d.minimumprijs)
    res.json({ ok:true, id, status, message:"Veiling aangemaakt" })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.put("/api/veiling/:id", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    const oldS=v.status, newS=req.body.status||oldS
    run("UPDATE veilingen SET "+Object.keys(req.body).map(k=>k+"=?").join(",")+",updated_at=datetime('now') WHERE id=?", [...Object.values(req.body), req.params.id])
    if(v.voorraad_id&&oldS!==newS){if(newS==="geannuleerd"||newS==="verlopen")run("UPDATE voorraad SET status='te_koop', updated_at=datetime('now') WHERE id=?",[v.voorraad_id]);else if(newS==="gewonnen")run("UPDATE voorraad SET status='verkocht', updated_at=datetime('now') WHERE id=?",[v.voorraad_id]);else if(newS==="actief"&&oldS==="gepland")run("UPDATE voorraad SET status='in_veiling', updated_at=datetime('now') WHERE id=?",[v.voorraad_id])}
    res.json({ ok:true })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.delete("/api/veiling/:id", authMiddleware, adminOnly, (req, res) => {
  try { const v=stmts.getVeiling.get(req.params.id); if(v&&v.voorraad_id&&v.status!=="gewonnen") run("UPDATE voorraad SET status='te_koop', updated_at=datetime('now') WHERE id=?",[v.voorraad_id]); stmts.deleteVeiling.run(req.params.id); res.json({ok:true}) } catch(e) { res.status(500).json({ok:false,error:e.message}) }
})

router.get("/api/admin/veilingen", authMiddleware, adminOnly, (req, res) => {
  try {
    const veilingen = queryAll("SELECT v.*, COALESCE(w.make,v.merk) as auto_merk, COALESCE(w.model,v.model) as auto_model, COALESCE(w.year,v.bouwjaar) as auto_bouwjaar, COALESCE(w.km,v.km) as auto_km, w.vraag_prijs as auto_vraagprijs, (SELECT COUNT(*) FROM car_photos WHERE voorraad_id=v.voorraad_id) as foto_count FROM veilingen v LEFT JOIN voorraad w ON w.id=v.voorraad_id ORDER BY v.created_at DESC")
    res.json({ ok:true, veilingen, stats: stmts.countVeilingen.get() })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.get("/api/admin/biedingen", authMiddleware, adminOnly, (req, res) => {
  try {
    const direct = queryAll("SELECT *, 'direct' as type FROM biedingen ORDER BY created_at DESC")
    const veiling = queryAll("SELECT vb.*, v.titel as veiling_titel, v.kenteken, v.status as veiling_status, 'veiling' as type FROM veiling_biedingen vb JOIN veilingen v ON v.id=vb.veiling_id ORDER BY vb.created_at DESC")
    res.json({ ok:true, direct, veiling, total:direct.length+veiling.length })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.get("/api/admin/verkopen", authMiddleware, adminOnly, (req, res) => { try { res.json({ok:true, verkopen:stmts.getVerkopen.all(200), stats:stmts.countVerkopen.get()}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })
router.get("/api/admin/facturen", authMiddleware, adminOnly, (req, res) => { try { res.json({ok:true, facturen:stmts.getAllFacturen.all(200), stats:stmts.countFacturen.get()}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })
router.put("/api/admin/factuur/:id", authMiddleware, adminOnly, express.json(), (req, res) => { try { const f=stmts.getFactuur.get(req.params.id); if(!f) return res.status(404).json({ok:false,error:"Niet gevonden"}); stmts.updateFactuur.run(f.id, req.body); writeLog("server.log","FACTUUR "+f.factuur_nr+" admin update"); res.json({ok:true}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })


/* ═══ AI SERVICE ═══ */
module.exports = router
