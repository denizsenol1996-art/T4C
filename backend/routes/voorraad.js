// routes/voorraad.js — voorraad CRUD, photo upload, public contact
const router = require("express").Router()
const express = require("express")
const fs = require("fs")
const path = require("path")
const { stmts, queryAll, queryOne, run, DATA_DIR } = require("../db")
const { authMiddleware, staffOnly } = require("../lib/auth")
const { writeLog } = require("../lib/state")

const PHOTOS_DIR = path.join(DATA_DIR, "photos")
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true })

let brandPhoto = null
try { brandPhoto = require("./branding").brandPhoto } catch(e) {}

router.get("/api/public/voorraad", (req, res) => {
  try {
    // Lees van dv_vehicles (echte DV/GO data) ipv voorraad tabel
    const dvCars = queryAll("SELECT * FROM dv_vehicles WHERE status='active' ORDER BY updated_at DESC")
    const cars = dvCars.map(d => {
      let fotos = []
      try { fotos = JSON.parse(d.afbeeldingen || '[]') } catch(e) {}
      let opties = []
      try { opties = JSON.parse(d.accessoires || '[]') } catch(e) {}
      return {
        id: d.id,
        hexon_id: d.hexon_id,
        kenteken: d.kenteken,
        make: d.merk,
        model: d.model,
        model_variant: d.type || '',
        year: d.bouwjaar,
        fuel: d.brandstof === 'B' ? 'Benzine' : d.brandstof === 'D' ? 'Diesel' : d.brandstof === 'E' ? 'Elektrisch' : d.brandstof === 'L' ? 'LPG' : d.brandstof === 'H' ? 'Hybride' : d.brandstof || '',
        km: d.tellerstand,
        color: d.kleur || '',
        body: d.carrosserie || '',
        power_hp: d.vermogen_pk,
        transmission: d.transmissie === 'A' ? 'Automaat' : d.transmissie === 'H' ? 'Handgeschakeld' : '',
        vraag_prijs: Number(d.prijs) || Number(d.meeneemprijs) || 0,
        beschrijving: d.opmerkingen || '',
        apk_until: d.apk_tot || '',
        status: 'te_koop',
        cover_photo: fotos.length > 0 ? fotos[0].url : '',
        photos: JSON.stringify(fotos.map(f => f.url)),
        options: opties.length > 0 ? JSON.stringify(opties) : '',
        doors: d.deuren,
        seats: d.zitplaatsen,
        btw_type: d.btw_marge || '',
        bron: 'dv',
        created_at: d.created_at,
        updated_at: d.updated_at
      }
    })
    res.json({ ok: true, cars, count: cars.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Public: single car detail
router.get("/api/public/voorraad/:id", (req, res) => {
  try {
    const d = queryOne("SELECT * FROM dv_vehicles WHERE id=?", [parseInt(req.params.id)])
    if (!d) return res.status(404).json({ ok: false, error: "Auto niet gevonden" })
    let fotos = []
    try { fotos = JSON.parse(d.afbeeldingen || '[]') } catch(e) {}
    let opties = []
    try { opties = JSON.parse(d.accessoires || '[]') } catch(e) {}
    const car = {
      id: d.id, hexon_id: d.hexon_id, kenteken: d.kenteken,
      make: d.merk, model: d.model, model_variant: d.type || '',
      year: d.bouwjaar,
      fuel: d.brandstof === 'B' ? 'Benzine' : d.brandstof === 'D' ? 'Diesel' : d.brandstof === 'E' ? 'Elektrisch' : d.brandstof === 'L' ? 'LPG' : d.brandstof === 'H' ? 'Hybride' : d.brandstof || '',
      km: d.tellerstand, color: d.kleur || '', body: d.carrosserie || '',
      power_hp: d.vermogen_pk,
      transmission: d.transmissie === 'A' ? 'Automaat' : d.transmissie === 'H' ? 'Handgeschakeld' : '',
      vraag_prijs: Number(d.prijs) || Number(d.meeneemprijs) || 0,
      beschrijving: d.opmerkingen || '',
      apk_until: d.apk_tot || '',
      status: 'te_koop',
      cover_photo: fotos.length > 0 ? fotos[0].url : '',
      photos: JSON.stringify(fotos.map(f => f.url)),
      options: opties.length > 0 ? JSON.stringify(opties) : '',
      doors: d.deuren, seats: d.zitplaatsen, btw_type: d.btw_marge || ''
    }
    const photos = fotos.map((f, i) => ({ id: i+1, filename: f.url, sort_order: i, is_cover: i === 0 ? 1 : 0 }))
    res.json({ ok: true, car, photos })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Admin: add car to voorraad
router.post("/api/voorraad/add", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    const result = stmts.addVoorraad.run({
      kenteken: d.kenteken || "", make: d.make || "", model: d.model || "",
      model_variant: d.model_variant || "", year: d.year || 0, fuel: d.fuel || "",
      km: d.km || 0, color: d.color || "", body: d.body || "",
      power_kw: d.power_kw || null, power_hp: d.power_hp || null,
      engine_label: d.engine_label || "", transmission: d.transmission || "",
      doors: d.doors || null, seats: d.seats || null,
      vraag_prijs: d.vraag_prijs || 0, beschrijving: d.beschrijving || "",
      highlights: d.highlights || "", apk_until: d.apk_until || "", vin: d.vin || "",
      status: d.status || "te_koop", featured: d.featured || false
    })
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Admin: update car
router.put("/api/voorraad/:id", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    stmts.updateVoorraad.run(parseInt(req.params.id), d)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Photo upload + auto-branding
// PHOTOS_DIR already defined above

// brandPhoto already loaded above

router.post("/api/voorraad/:id/photos", authMiddleware, staffOnly, express.raw({ type: "image/*", limit: "10mb" }), async (req, res) => {
  try {
    const carId = parseInt(req.params.id)
    const ext = (req.headers["content-type"] || "image/jpeg").split("/")[1] || "jpeg"
    const ts = Date.now()
    const origFilename = `car-${carId}-${ts}-orig.${ext}`
    const brandedFilename = `car-${carId}-${ts}.${ext}`
    const origPath = path.join(PHOTOS_DIR, origFilename)
    const brandedPath = path.join(PHOTOS_DIR, brandedFilename)

    // Save original
    fs.writeFileSync(origPath, req.body)

    // Brand the photo
    try {
      await brandPhoto(origPath, brandedPath)
      console.log(`[PHOTO] Branded: ${brandedFilename}`)
    } catch (brandErr) {
      console.error(`[PHOTO] Branding failed, using original:`, brandErr.message)
      fs.copyFileSync(origPath, brandedPath)
    }

    // Save to DB (branded version)
    const existing = stmts.getVoorraadPhotos.all(carId)
    const isCover = existing.length === 0 ? 1 : 0
    stmts.addCarPhoto.run(carId, brandedFilename, existing.length, isCover)

    res.json({ ok: true, filename: brandedFilename, original: origFilename, branded: true, cover: !!isCover })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Add photo by URL (for imports)
router.post("/api/voorraad/:id/photo-url", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const carId = parseInt(req.params.id)
    const url = req.body.url
    if (!url) return res.status(400).json({ ok: false, error: "URL vereist" })
    const existing = stmts.getVoorraadPhotos.all(carId)
    const isCover = existing.length === 0 ? 1 : 0
    stmts.addCarPhoto.run(carId, url, existing.length, isCover)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Serve photos statically
router.use("/photos", express.static(PHOTOS_DIR))

// Public: contact form
router.post("/api/public/contact", (req, res) => {
  const d = req.body || {}
  const naam = d.naam || d.name || ""
  const email = d.email || ""
  const telefoon = d.telefoon || d.phone || ""
  const onderwerp = d.onderwerp || ""
  const bericht = d.bericht || d.message || ""
  console.log(`[CONTACT] ${naam} | ${email} | ${telefoon} | ${onderwerp}`)
  try {
    run("INSERT INTO contact_requests (naam,email,telefoon,onderwerp,bericht,type,status) VALUES (?,?,?,?,?,?,?)",
      [naam, email, telefoon, onderwerp, bericht, "contact", "nieuw"])
  } catch(e) { console.error("[CONTACT] Save error:", e.message) }
  res.json({ ok: true, message: "Bedankt! We nemen snel contact op." })
})


/* ═══════════════════════════════════════════════
   TRANSPORT BEREKENING
   ═══════════════════════════════════════════════ */

function calcTransport(afstandKm, opslagPct = 10) {
  const basis = 40 + (0.60 * afstandKm)
  const totaal = basis * (1 + opslagPct / 100)
  return { basis: Math.round(basis * 100) / 100, totaal: Math.round(totaal * 100) / 100 }
}

/* ═══════════════════════════════════════════════
   INSPECTIE & GEBREKEN
   ═══════════════════════════════════════════════ */


router.post("/api/voorraad/:id/photos/enhanced", authMiddleware, staffOnly, express.raw({ type: "image/*", limit: "10mb" }), async (req, res) => {
  try {
    const Jimp = require("jimp")
    const carId = parseInt(req.params.id)
    const ts = Date.now()
    const origFilename = `car-${carId}-${ts}-orig.jpg`
    const brandedFilename = `car-${carId}-${ts}.jpg`
    
    fs.writeFileSync(path.join(PHOTOS_DIR, origFilename), req.body)
    
    // AI Enhancement: brightness, contrast, sharpness, saturation
    const img = await Jimp.read(req.body)
    let totalBright = 0, pixels = 0
    img.scan(0, 0, img.getWidth(), img.getHeight(), function(x, y, idx) {
      totalBright += (this.bitmap.data[idx] + this.bitmap.data[idx+1] + this.bitmap.data[idx+2]) / 3
      pixels++
    })
    const avgBright = totalBright / pixels
    if (avgBright < 110) img.brightness((110 - avgBright) / 255 * 0.8)
    else if (avgBright > 180) img.brightness((180 - avgBright) / 255 * 0.4)
    img.contrast(0.12)
    img.convolute([[0,-0.5,0],[-0.5,3,-0.5],[0,-0.5,0]])
    img.color([{ apply: "saturate", params: [15] }])
    
    const enhancedPath = path.join(PHOTOS_DIR, `car-${carId}-${ts}-enhanced.jpg`)
    await img.quality(92).writeAsync(enhancedPath)
    
    // Brand the enhanced version
    try { await brandPhoto(enhancedPath, path.join(PHOTOS_DIR, brandedFilename)) }
    catch { fs.copyFileSync(enhancedPath, path.join(PHOTOS_DIR, brandedFilename)) }
    
    const existing = stmts.getVoorraadPhotos.all(carId)
    stmts.addCarPhoto.run(carId, brandedFilename, existing.length, existing.length === 0 ? 1 : 0)
    
    res.json({ ok: true, filename: brandedFilename, original: origFilename, enhanced: true, branded: true, cover: existing.length === 0 })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

/* ═══════════════════════════════════════════════
   PLATFORM EXPORT
   ═══════════════════════════════════════════════ */


router.get("/api/voorraad", authMiddleware, (req, res) => {
  try {
    const cars = stmts.getVoorraadAll.all()
    res.json({ ok: true, cars, count: cars.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Voorraad: DELETE ──
router.delete("/api/voorraad/:id", authMiddleware, staffOnly, (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const car = stmts.getVoorraadById.get(id)
    if (!car) return res.status(404).json({ ok: false, error: "Auto niet gevonden" })
    // Delete photos from filesystem
    const photos = stmts.getVoorraadPhotos.all(id)
    for (const p of photos) {
      try {
        const fpath = path.join(PHOTOS_DIR, p.filename)
        if (fs.existsSync(fpath)) fs.unlinkSync(fpath)
        // Also try to remove branded/original variants
        const origPath = fpath.replace(/(\.\w+)$/, "-orig$1")
        if (fs.existsSync(origPath)) fs.unlinkSync(origPath)
      } catch {}
    }
    stmts.deletePhotosByVoorraad.run(id)
    stmts.deleteVoorraad.run(id)
    res.json({ ok: true, message: `Auto ${car.make} ${car.model} verwijderd` })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Voorraad: DELETE single photo ──
router.delete("/api/voorraad/:carId/photos/:photoId", authMiddleware, (req, res) => {
  try {
    const photoId = parseInt(req.params.photoId)
    const photo = stmts.getCarPhoto.get(photoId)
    if (!photo) return res.status(404).json({ ok: false, error: "Foto niet gevonden" })
    // Delete from filesystem
    try {
      const fpath = path.join(PHOTOS_DIR, photo.filename)
      if (fs.existsSync(fpath)) fs.unlinkSync(fpath)
    } catch {}
    stmts.deleteCarPhoto.run(photoId)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})



module.exports = router
