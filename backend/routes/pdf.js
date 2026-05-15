// routes/pdf.js — /api/pdf (taxatie rapport generation)
const router = require("express").Router()
const express = require("express")
const { authMiddleware, staffOnly } = require("../lib/auth")
const { fmtE } = require("../lib/helpers")
const PDFDocument = require("pdfkit")
const path = require("path")
const fs = require("fs")

router.post("/api/pdf", authMiddleware, staffOnly, express.json({limit:"2mb"}), async (req, res) => {
  const data = req.body
  if (!data?.vehicle?.make) return res.status(400).json({error:"Missing vehicle data"})
  const v = data.vehicle||{}, r = data.result||{}, m = data.market||{}, km = data.km||0

  try {
    const doc = new PDFDocument({ size:"A4", margin:40, autoFirstPage:false,
      info:{ Title:`CarDatax Taxatie - ${v.make} ${v.model}`, Author:"CarDatax Intelligent Pricing" }})

    const chunks = []
    doc.on("data", c => chunks.push(c))
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks)
      const plate = (v.plate||"onbekend").replace(/[^A-Za-z0-9-]/g,"")
      res.setHeader("Content-Type","application/pdf")
      res.setHeader("Content-Disposition",`attachment; filename="CarDatax_${plate}.pdf"`)
      res.send(pdf)
    })

    const fE = n => { if(!n||!isFinite(n)) return "\u2014"; return "\u20AC "+Math.round(n).toLocaleString("nl-NL") }
    const fN = n => { if(!n||!isFinite(n)) return "\u2014"; return Math.round(n).toLocaleString("nl-NL") }
    const PW = 515 // page width minus margins

    const ACCENT="#00FF9C",GREEN="#00FF9C",RED="#ef4444",TXT="#e8eaf0",TXT2="#8e94a8",TXT3="#505770",DARK="#060709",SURFACE="#1a1e27"
    const today = new Date().toLocaleDateString("nl-NL")

    const logoPath = path.join(__dirname,"..","sites","cardatax","logo-cardatax.png")
    function footer(d) {
      try { d.image(logoPath,40,808,{height:12}) } catch(e){}
      d.fontSize(6).fill(TXT3)
      const fModel = (v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim() || v.model || ""
      d.text(`${v.make||""} ${fModel} \u2014 ${v.plate||""}`,220,813,{lineBreak:false})
      d.text(today,460,813,{lineBreak:false})
    }

    // ════════════════════════════════════════
    // PAGE 1: TAXATIE RAPPORT
    // ════════════════════════════════════════
    doc.addPage({size:"A4",margin:40})
    doc.rect(0,0,595,842).fill(DARK)

    // ── HEADER ──
    doc.roundedRect(40,28,PW,36,6).fill(SURFACE)
    try { doc.image(logoPath,48,30,{height:32}) } catch(e){}
    doc.fontSize(12).fill(TXT).text(v.plate||"",40,36,{width:PW-12,align:"right",lineBreak:false})
    doc.fontSize(7).fill(TXT3).text(today,40,50,{width:PW-12,align:"right",lineBreak:false})

    // ── VOERTUIG ──
    let y = 78
    const dispModel = (v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim() || v.model || ""
    doc.fontSize(18).fill(TXT).text(`${v.make||""} ${dispModel}`,40,y,{lineBreak:false}); y+=22
    if (v.modelVariant) { doc.fontSize(8).fill(ACCENT).text(v.modelVariant,40,y,{lineBreak:false}); y+=12 }
    const info = [v.year, v.fuel, v.powerHp?`${v.powerHp} pk`:null, km?`${fN(km)} km`:null].filter(Boolean).join("  \u00B7  ")
    doc.fontSize(8).fill(TXT2).text(info,40,y,{lineBreak:false}); y+=18

    // ── PRIJZEN ──
    doc.roundedRect(40,y,PW,42,6).fill(SURFACE)
    doc.fontSize(22).fill(ACCENT).text(`${fE(r.inkoopLow)}  \u2014  ${fE(r.inkoopHigh)}`,40,y+6,{width:PW,align:"center",lineBreak:false})
    doc.fontSize(6.5).fill(TXT3).text("CarDatax Inkoop Advies  \u2014  aanbevolen biedrange bij particulier/inruil",40,y+30,{width:PW,align:"center",lineBreak:false})
    y+=50

    const prices = [
      ["Verkoopadviees (B2C)",fE(r.verkoopadviees),false],
      ["Handelswaarde (B2B)",fE(r.handelswaarde),false],
      ["CarDatax Inkoop Advies",`${fE(r.inkoopLow)} \u2014 ${fE(r.inkoopHigh)}`,true],
      ["Internet vraagprijs",fE(r.internetPrijs),false]
    ]
    for (const [label,val,hl] of prices) {
      if(hl) doc.roundedRect(40,y-2,PW,16,3).fillOpacity(0.06).fill(ACCENT).fillOpacity(1)
      doc.fontSize(8.5).fill(hl?ACCENT:TXT2).text(label,50,y,{lineBreak:false})
      doc.fontSize(9).fill(hl?ACCENT:TXT).text(String(val),40,y,{width:PW-10,align:"right",lineBreak:false})
      if(!hl){doc.save().strokeOpacity(0.04).moveTo(50,y+12).lineTo(40+PW-10,y+12).strokeColor(TXT3).stroke().restore()}
      y+=15
    }
    y+=12

    // ── SCORES ──
    doc.fontSize(5.5).fill(TXT3).text("SCORES",40,y,{lineBreak:false}); y+=8
    const scGap=5, scBW=(PW-(scGap*4))/5
    const sc = [
      ["ATR",r.atrScore?r.atrScore+"/10":"\u2014",ACCENT],
      ["ETR",r.etrScore?r.etrScore+"/10":"\u2014",ACCENT],
      ["LIQUIDITEIT",r.liquidityScore||"\u2014",r.liquidityScore>=55?GREEN:r.liquidityScore>=30?ACCENT:RED],
      ["RISICO",r.riskScore||"\u2014",(r.riskScore||50)<30?GREEN:(r.riskScore||50)<50?ACCENT:RED],
      ["BETROUWBAAR",r.confidence?r.confidence+"%":"\u2014",r.confidence>=70?GREEN:r.confidence>=50?ACCENT:RED]
    ]
    for(let i=0;i<5;i++){
      const sx=40+i*(scBW+scGap)
      doc.roundedRect(sx,y,scBW,32,4).fill(SURFACE)
      doc.fontSize(5).fill(TXT3).text(sc[i][0],sx,y+4,{width:scBW,align:"center",lineBreak:false})
      doc.fontSize(13).fill(sc[i][2]).text(String(sc[i][1]),sx,y+13,{width:scBW,align:"center",lineBreak:false})
    }
    y+=40

    // ── RENDEMENT ──
    doc.fontSize(5.5).fill(TXT3).text("RENDEMENT",40,y,{lineBreak:false}); y+=8
    const prGap=5, prBW=(PW-prGap*3)/4
    const pr=[
      ["WINST B2B",fE(r.profitWholesale),r.profitWholesale>0?GREEN:RED],
      ["WINST B2C",fE(r.profitRetail),GREEN],
      ["MARGE",`${r.marginPercent||0}%`,ACCENT],
      ["BPM REST",v.bpmRest?fE(v.bpmRest):"\u2014",TXT2]
    ]
    for(let i=0;i<4;i++){
      const px=40+i*(prBW+prGap)
      doc.roundedRect(px,y,prBW,26,4).fill(SURFACE)
      doc.fontSize(4.5).fill(TXT3).text(pr[i][0],px,y+4,{width:prBW,align:"center",lineBreak:false})
      doc.fontSize(10).fill(pr[i][2]).text(pr[i][1],px,y+13,{width:prBW,align:"center",lineBreak:false})
    }
    y+=34

    // ── STATUS ──
    const badges=[r.courantLabel,r.confidenceLabel?`${r.confidenceLabel} (${r.confidence}%)`:null,r.sellSpeed&&r.sellSpeed!=='Onbekend'?`${r.sellSpeed} (~${r.sellDays}d)`:null,r.jpEtr?`ETR ${r.jpEtr}`:null].filter(Boolean)
    doc.fontSize(7).fill(ACCENT).text(badges.join("   \u00B7   "),40,y,{lineBreak:false}); y+=16

    // ── ANALYSE ──
    const tips=r.smartSummary||[]
    if(tips.length){
      doc.save().strokeOpacity(0.06).moveTo(40,y).lineTo(40+PW,y).strokeColor(TXT3).stroke().restore(); y+=7
      doc.fontSize(5.5).fill(TXT3).text("ANALYSE",40,y,{lineBreak:false}); y+=10
      for(const t of tips.slice(0,6)){
        const isWarn=t.includes("GESTOLEN")||t.includes("Beperkte")||t.includes("Geen")||t.includes("IMPORT")
        doc.fontSize(7).fill(isWarn?RED:GREEN).text(isWarn?"\u26A0":"\u2713",42,y,{lineBreak:false})
        doc.fill(TXT2).text(t.slice(0,100),54,y,{lineBreak:false}); y+=10
      }
      y+=4
    }

    // ── MARKTDATA ──
    if(m.count){
      doc.save().strokeOpacity(0.06).moveTo(40,y).lineTo(40+PW,y).strokeColor(TXT3).stroke().restore(); y+=7
      doc.fontSize(5.5).fill(TXT3).text(`MARKTDATA  \u2014  ${m.count} vergelijkbare auto's`,40,y,{lineBreak:false}); y+=10
      const pVals = [["P10",m.p10],["P25",m.p25],["MEDIAAN",m.median],["P75",m.p75],["P90",m.p90]].filter(x=>x[1]>0)
      const pW = PW / pVals.length
      for(let i=0;i<pVals.length;i++){
        const px=40+i*pW, isMed=pVals[i][0]==="MEDIAAN"
        doc.fontSize(5).fill(TXT3).text(pVals[i][0],px,y,{width:pW,align:"center",lineBreak:false})
        doc.fontSize(isMed?10:8).fill(isMed?ACCENT:TXT2).text(fE(pVals[i][1]),px,y+7,{width:pW,align:"center",lineBreak:false})
      }
    }

    footer(doc)

    // ════════════════════════════════════════
    // PAGE 2: VOERTUIGGEGEVENS
    // ════════════════════════════════════════
    doc.addPage({size:"A4",margin:40})
    doc.rect(0,0,595,842).fill(DARK)

    // Header
    doc.roundedRect(40,28,PW,30,6).fill(SURFACE)
    try { doc.image(logoPath,48,31,{height:24}) } catch(e){}
    doc.fontSize(12).fill(TXT2).text("Voertuiggegevens",160,34,{lineBreak:false})
    doc.fontSize(8).fill(TXT3).text(`${v.plate||""} \u2014 ${v.make||""} ${((v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim())||v.model||""}`,40,36,{width:PW-12,align:"right",lineBreak:false})

    // Section drawing helper
    const hW = PW/2 - 12
    function sec(title, items, sy, xO) {
      doc.fontSize(9).fill(ACCENT).text(title,xO,sy,{lineBreak:false}); sy+=13
      doc.save().strokeOpacity(0.2).moveTo(xO,sy).lineTo(xO+hW,sy).strokeColor(ACCENT).stroke().restore(); sy+=6
      for(const[l,val]of items){
        if(!val || String(val)==="\u2014" || String(val)==="undefined" || String(val)==="null" || String(val)==="0" || String(val)==="false") continue
        doc.fontSize(8).fill(TXT2).text(String(l),xO+2,sy,{lineBreak:false})
        doc.fontSize(8).fill(TXT).text(String(val).slice(0,42),xO,sy,{width:hW,align:"right",lineBreak:false})
        sy+=13
      }
      return sy
    }

    // ── LEFT COLUMN ──
    let y1 = sec("Algemeen",[
      ["Merk",v.make],["Model",((v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim())||v.model],["Uitvoering",v.modelVariant],
      ["Bouwjaar",v.year],["Brandstof",v.fuel],
      [v.fuelSecondary?"2e brandstof":null,v.fuelSecondary],
      [v.isHybrid?"Aandrijving":null,v.isHybrid?"Hybride":null],
      [v.isPureEV?"Aandrijving":null,v.isPureEV?"Volledig Elektrisch":null],
      ["Carrosserie",v.body],["Kleur",v.color],
      [v.colorSecondary?"2e kleur":null,v.colorSecondary],
      [v.doors?"Deuren":null,v.doors],
      [v.seats?"Zitplaatsen":null,v.seats],
    ], 60, 40)

    y1 = sec("Motor & Transmissie",[
      ["Motor type",v.engineLabel],
      [v.engineCapacity?"Cilinderinhoud":null,v.engineCapacity?`${fN(v.engineCapacity)} cc`:null],
      [v.cylinders?"Cilinders":null,v.cylinders],
      [v.engineCode?"Motorcode":null,v.engineCode],
      [v.powerKw?"Vermogen":null,v.powerHp?`${v.powerHp} pk (${v.powerKw} kW)`:null],
      [v.topSpeed?"Topsnelheid":null,v.topSpeed?`${v.topSpeed} km/u`:null],
      [v.transmissionType&&v.transmissionType!=="Onbekend"?"Transmissie":null,
        v.transmissionType&&v.transmissionType!=="Onbekend"?`${v.transmissionType}${v.gearCount?` (${v.gearCount}-bak)`:""}`
        :null],
      [v.equipmentLevel?"Uitrusting":null,v.equipmentLevel],
    ], y1+8, 40)

    y1 = sec("Milieu & Verbruik",[
      [v.emissionClass||v.emissieKlasse?"Emissieklasse":null,v.emissionClass||v.emissieKlasse],
      [v.energyLabel||v.energielabel?"Energielabel":null,v.energyLabel||v.energielabel],
      [v.co2?"CO2":null,v.co2?`${v.co2} g/km`:null],
      [v.co2Wltp?"CO2 (WLTP)":null,v.co2Wltp?`${v.co2Wltp} g/km`:null],
      [v.verbruik?.gecombineerd||v.fuelConsumptionCombined?"Verbruik combi":null,(v.verbruik?.gecombineerd||v.fuelConsumptionCombined)?`${v.verbruik?.gecombineerd||v.fuelConsumptionCombined} l/100km`:null],
      [v.verbruik?.stad?"Verbruik stad":null,v.verbruik?.stad?`${v.verbruik.stad} l/100km`:null],
      [v.verbruik?.snelweg?"Verbruik snelweg":null,v.verbruik?.snelweg?`${v.verbruik.snelweg} l/100km`:null],
      [v.actieradius||v.electricRange?"EV bereik":null,(v.actieradius||v.electricRange)?`${v.actieradius||v.electricRange} km`:null],
      [v.roetFilter?"Roetfilter":null,v.roetFilter],
    ], y1+8, 40)

    // ── RIGHT COLUMN ──
    const rx = 40 + hW + 24
    let y2 = sec("Afmetingen & Gewicht",[
      [v.weightKg?"Gewicht":null,v.weightKg?`${fN(v.weightKg)} kg`:null],
      [v.maxMass?"Max massa":null,v.maxMass?`${fN(v.maxMass)} kg`:null],
      [v.lengthMm?"Lengte":null,v.lengthMm?`${v.lengthMm} mm`:null],
      [v.widthMm?"Breedte":null,v.widthMm?`${v.widthMm} mm`:null],
      [v.heightMm?"Hoogte":null,v.heightMm?`${v.heightMm} mm`:null],
      [v.wheelbase?"Wielbasis":null,v.wheelbase?`${v.wheelbase} mm`:null],
      [v.towCapacityBraked?"Trek geremd":null,v.towCapacityBraked?`${fN(v.towCapacityBraked)} kg`:null],
    ], 60, rx)

    y2 = sec("Status & Registratie",[
      [v.handelsbenaming?"Handelsbenaming":null,v.handelsbenaming],
      ["1e toelating",v.firstAdmission],
      [v.firstAdmissionNL?"1e toelating NL":null,v.firstAdmissionNL],
      ["APK tot",v.apkUntil],
      [v.ownerCount?"Eigenaren":null,v.ownerCount?`${v.ownerCount}x`:null],
      [v.lastOwnerType?"Laatste eigenaar":null,v.lastOwnerType],
      [v.importFlag?"Import":null,v.importFlag?"Ja":null],
      [v.stolenFlag?"Gestolen":null,v.stolenFlag?"\u26A0 JA":null],
      ["WAM",v.wamInsured?"Verzekerd":"Niet verzekerd"],
      [v.typegoedkeuringNr?"Typegoedkeuring":null,v.typegoedkeuringNr],
    ], y2+8, rx)

    y2 = sec("Fiscaal & BPM",[
      ["Catalogusprijs",fE(v.catalogPrice)],
      ["BPM (nieuw)",fE(v.bpm||v.bpmNieuw)],
      [v.bpmRest?"BPM rest":null,v.bpmRest?`${fE(v.bpmRest)} (${v.bpmRestPct||0}%)`:null],
      [v.bijtelling?"Bijtelling":null,v.bijtelling?`${v.bijtelling}%`:null],
      [v.taxQuarterMin?"MRB kwartaal":null,v.taxQuarterMin?`\u20AC ${v.taxQuarterMin}${v.taxQuarterMax?` \u2013 \u20AC ${v.taxQuarterMax}`:""}`  :null],
      ["Leeftijd",v.year?`${new Date().getFullYear()-v.year} jaar`:null],
    ], y2+8, rx)

    // ── APK HISTORY ──
    const apkH = v.apkHistory||[]
    if(apkH.length) {
      y2 = sec("APK Keuringen", apkH.slice(0,6).map(a => [
        a.date, `${a.result}${a.km?` \u2014 ${fN(a.km)} km`:""}`
      ]), y2+8, rx)
    }

    // ── KM HISTORY (below both columns) ──
    const kh = v.kmHistory||[]
    let yK = Math.max(y1,y2)+14
    if(kh.length && yK<720){
      doc.fontSize(9).fill(ACCENT).text("Kilometerhistorie",40,yK,{lineBreak:false}); yK+=13
      doc.save().strokeOpacity(0.2).moveTo(40,yK).lineTo(40+PW,yK).strokeColor(ACCENT).stroke().restore(); yK+=7
      doc.fontSize(7).fill(TXT3)
      doc.text("DATUM",42,yK,{lineBreak:false})
      doc.text("KM-STAND",180,yK,{lineBreak:false})
      doc.text("VERSCHIL",320,yK,{lineBreak:false})
      yK+=13
      let prev=0
      for(const e of kh.slice(0,16)){
        if(yK>790) break
        const kv=e.km||0, d=prev?kv-prev:0
        doc.fontSize(8).fill(TXT2).text(e.date||"",42,yK,{lineBreak:false})
        doc.fill(TXT).text(fN(kv),180,yK,{lineBreak:false})
        if(prev) doc.fill(d<0?RED:TXT2).text(`${d>=0?"+":""}${fN(d)}`,320,yK,{lineBreak:false})
        prev=kv; yK+=12
      }
    }

    // ── RECALLS ──
    const recalls = v.recalls||[]
    if(recalls.length && yK<760) {
      yK+=6
      doc.fontSize(9).fill(ACCENT).text("Terugroepacties",40,yK,{lineBreak:false}); yK+=13
      for(const rc of recalls.slice(0,4)){
        if(yK>790) break
        doc.fontSize(8).fill(TXT2).text(`${rc.description||""} \u2014 ${rc.status||""}`,42,yK,{lineBreak:false})
        yK+=12
      }
    }

    // Sources
    const src = (r.sources||[]).join(" + ")
    if(src) {
      doc.fontSize(7).fill(TXT3).text(`Bronnen: ${src}`,40,800,{lineBreak:false})
    }

    footer(doc)

    // ── DONE — exactly 2 pages ──
    // PAGE 3: INTELLIGENCE (optional — only if data available)
    const intel = data.intel
    if(intel && (intel.season || intel.trends || intel.velocity || intel.arbitrage)) {
      doc.addPage({size:"A4",margin:40})
      doc.rect(0,0,595,842).fill(DARK)

      // Header
      doc.roundedRect(40,28,PW,30,6).fill(SURFACE)
      try { doc.image(logoPath,48,31,{height:24}) } catch(e){}
      doc.fontSize(12).fill(ACCENT).text("Market Intelligence",160,34,{lineBreak:false})
      doc.fontSize(8).fill(TXT3).text(`${v.make||""} ${((v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim())||v.model||""} (${v.year||""})`,40,36,{width:PW-12,align:"right",lineBreak:false})

      let yi = 72

      // Season
      if(intel.season) {
        doc.fontSize(9).fill(ACCENT).text("Seizoenscorrectie",40,yi,{lineBreak:false}); yi+=13
        doc.save().strokeOpacity(0.2).moveTo(40,yi).lineTo(40+PW,yi).strokeColor(ACCENT).stroke().restore(); yi+=6
        doc.fontSize(8).fill(TXT2).text(intel.season.reason || "Geen seizoenseffect",42,yi,{lineBreak:false})
        doc.fontSize(8).fill(TXT).text(`${intel.season.factor > 1 ? "+" : ""}${Math.round((intel.season.factor - 1) * 100)}%`,40,yi,{width:PW-10,align:"right",lineBreak:false})
        yi+=18
      }

      // Trends
      if(intel.trends) {
        doc.fontSize(9).fill(ACCENT).text("Prijstrend",40,yi,{lineBreak:false}); yi+=13
        doc.save().strokeOpacity(0.2).moveTo(40,yi).lineTo(40+PW,yi).strokeColor(ACCENT).stroke().restore(); yi+=6
        if(intel.trends.direction) {
          const arrow = intel.trends.direction === "up" ? "\u2191" : intel.trends.direction === "down" ? "\u2193" : "\u2192"
          doc.fontSize(8).fill(TXT2).text("Richting",42,yi,{lineBreak:false})
          doc.fontSize(8).fill(intel.trends.direction==="up"?GREEN:intel.trends.direction==="down"?RED:TXT).text(`${arrow} ${intel.trends.direction} (${intel.trends.changePct||0}%)`,40,yi,{width:PW-10,align:"right",lineBreak:false})
          yi+=13
        }
        if(intel.trends.periodDays) {
          doc.fontSize(8).fill(TXT2).text("Periode",42,yi,{lineBreak:false})
          doc.fontSize(8).fill(TXT).text(`${intel.trends.periodDays} dagen`,40,yi,{width:PW-10,align:"right",lineBreak:false})
          yi+=13
        }
        yi+=5
      }

      // Velocity
      if(intel.velocity) {
        doc.fontSize(9).fill(ACCENT).text("Marktsnelheid",40,yi,{lineBreak:false}); yi+=13
        doc.save().strokeOpacity(0.2).moveTo(40,yi).lineTo(40+PW,yi).strokeColor(ACCENT).stroke().restore(); yi+=6
        const velItems = [
          ["Aanbod",intel.velocity.supply||"\u2014"],
          ["Verkoopsnelheid",intel.velocity.speed||"\u2014"],
          ["Gem. stadagen",intel.velocity.avgDays ? `${intel.velocity.avgDays}d` : "\u2014"],
          ["Marktdruk",intel.velocity.pressure||"\u2014"]
        ]
        for(const[l,val] of velItems){
          doc.fontSize(8).fill(TXT2).text(l,42,yi,{lineBreak:false})
          doc.fontSize(8).fill(TXT).text(String(val),40,yi,{width:PW-10,align:"right",lineBreak:false})
          yi+=13
        }
        yi+=5
      }

      // Arbitrage
      if(intel.arbitrage && intel.arbitrage.count > 0) {
        doc.fontSize(9).fill(ACCENT).text("Arbitrage Signalen",40,yi,{lineBreak:false}); yi+=13
        doc.save().strokeOpacity(0.2).moveTo(40,yi).lineTo(40+PW,yi).strokeColor(ACCENT).stroke().restore(); yi+=6
        doc.fontSize(8).fill(TXT2).text("Kansen gevonden",42,yi,{lineBreak:false})
        doc.fontSize(8).fill(GREEN).text(String(intel.arbitrage.count),40,yi,{width:PW-10,align:"right",lineBreak:false})
        yi+=13
        if(intel.arbitrage.bestDiscount) {
          doc.fontSize(8).fill(TXT2).text("Beste korting",42,yi,{lineBreak:false})
          doc.fontSize(8).fill(GREEN).text(`-${intel.arbitrage.bestDiscount}%`,40,yi,{width:PW-10,align:"right",lineBreak:false})
          yi+=13
        }
        yi+=5
      }

      // Confidence breakdown
      const conf = data.confidence || r.confidence || 0
      if(conf > 0) {
        doc.fontSize(9).fill(ACCENT).text("Betrouwbaarheid",40,yi,{lineBreak:false}); yi+=13
        doc.save().strokeOpacity(0.2).moveTo(40,yi).lineTo(40+PW,yi).strokeColor(ACCENT).stroke().restore(); yi+=6
        doc.fontSize(8).fill(TXT2).text("Confidence score",42,yi,{lineBreak:false})
        doc.fontSize(8).fill(conf>=70?GREEN:conf>=50?ACCENT:RED).text(`${conf}%`,40,yi,{width:PW-10,align:"right",lineBreak:false})
        yi+=13
        const mCnt = m?.count || data.market?.count || 0
        doc.fontSize(8).fill(TXT2).text("Vergelijkbare listings",42,yi,{lineBreak:false})
        doc.fontSize(8).fill(TXT).text(String(mCnt),40,yi,{width:PW-10,align:"right",lineBreak:false})
        yi+=18
      }

      // Disclaimer
      doc.fontSize(7).fill(TXT3).text("Intelligence data is gebaseerd op geautomatiseerde marktanalyse. Resultaten zijn indicatief.",40,790,{width:PW,lineBreak:true})

      footer(doc)
    }

    // ════════════════════════════════════════
    // PAGE 3: SCHADE-CORRECTIE (alleen bij extended taxatie)
    // ════════════════════════════════════════
    const ext = data.extended
    if (ext) {
      doc.addPage({size:"A4",margin:40})
      doc.rect(0,0,595,842).fill(DARK)
      
      // Logo + header bar
      const logoLg = path.join(__dirname,"..","sites","cardatax","m","logo-sidebar.png")
      try { doc.image(logoLg,40,28,{height:28}) } catch(e){ try { doc.image(logoPath,40,30,{height:18}) } catch(e2){} }
      doc.fontSize(10).fill(TXT3).text("SCHADE-INSPECTIE",440,35,{width:115,align:"right"})
      doc.save().strokeOpacity(0.15).moveTo(40,62).lineTo(40+PW,62).strokeColor(ACCENT).stroke().restore()
      
      // Kenteken + auto info
      doc.roundedRect(40,70,PW,42,6).fill(SURFACE)
      doc.fontSize(18).fill(TXT).text(v.plate||"",52,76,{lineBreak:false})
      const fModel2 = (v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim()
      doc.fontSize(10).fill(TXT2).text((v.make||"")+" "+(fModel2||""),250,78,{lineBreak:false})
      doc.fontSize(9).fill(TXT3).text((v.year||"")+" \u2022 "+fN(km)+" km \u2022 "+(v.fuel||""),250,92,{lineBreak:false})
      doc.fontSize(9).fill(TXT3).text(today,40,92,{width:PW-10,align:"right",lineBreak:false})
      
      let yi = 124
      
      // ── PRIJSCORRECTIE ──
      doc.roundedRect(40,yi,PW,65,6).fill(SURFACE)
      doc.save().roundedRect(40,yi,PW,18,6).fill("#111520").restore()
      doc.fontSize(8).fill(ACCENT).text("PRIJSCORRECTIE",52,yi+5)
      
      // 3 kolommen
      const colW = Math.floor(PW/3)
      doc.fontSize(8).fill(TXT3).text("Basis verkoopprijs",52,yi+24)
      doc.fontSize(14).fill(TXT2).text(fE(ext.basisVP),52,yi+36,{lineBreak:false})
      
      doc.fontSize(8).fill(TXT3).text("Gecorrigeerde prijs",52+colW,yi+24)
      doc.fontSize(14).fill(GREEN).text(fE(ext.gecorrigeerdVP),52+colW,yi+36,{lineBreak:false})
      
      doc.fontSize(8).fill(TXT3).text("Totale correctie",52+colW*2,yi+24)
      doc.fontSize(14).fill("#f59e0b").text((ext.correctiePct||0)+"%  ("+fE(ext.correctieBedrag)+")",52+colW*2,yi+36,{lineBreak:false})
      
      yi += 76
      
      // ── CORRECTIE ITEMS ──
      if (ext.correctieItems && ext.correctieItems.length > 0) {
        const itemH = 16 + ext.correctieItems.length * 20
        doc.roundedRect(40,yi,PW,itemH,6).fill(SURFACE)
        doc.save().roundedRect(40,yi,PW,18,6).fill("#111520").restore()
        doc.fontSize(8).fill(ACCENT).text("TOEGEPASTE CORRECTIES",52,yi+5)
        yi += 22
        for (const item of ext.correctieItems) {
          doc.fontSize(9).fill(TXT).text(item.label||"",52,yi,{lineBreak:false})
          doc.fontSize(9).fill(TXT3).text(Math.round(item.pct*100)+"%",350,yi,{lineBreak:false})
          doc.fontSize(9).fill("#f59e0b").text(fE(item.bedrag),40,yi,{width:PW-10,align:"right",lineBreak:false})
          yi += 20
        }
        yi += 6
      }
      
      // ── AI FOTO-ANALYSE ──
      const pa = ext.photoAnalysis
      if (pa && !pa.error) {
        doc.roundedRect(40,yi,PW,72,6).fill(SURFACE)
        doc.save().roundedRect(40,yi,PW,18,6).fill("#111520").restore()
        doc.fontSize(8).fill(ACCENT).text("CARDATAX VISION \u2014 AI FOTO-ANALYSE",52,yi+5)
        
        doc.fontSize(9).fill(TXT3).text("Algehele staat",52,yi+24,{lineBreak:false})
        doc.fontSize(11).fill(pa.algehele_staat==="goed"?GREEN:"#f59e0b").text(pa.algehele_staat||"onbekend",130,yi+23,{lineBreak:false})
        
        doc.fontSize(9).fill(TXT3).text("Schade",250,yi+24,{lineBreak:false})
        doc.fontSize(11).fill(pa.schade==="geen"?GREEN:pa.schade==="licht"?"#f59e0b":RED).text(pa.schade||"onbekend",300,yi+23,{lineBreak:false})
        
        if(pa.schade_details) doc.fontSize(8).fill(TXT2).text(pa.schade_details,52,yi+42,{width:PW-30})
        if(pa.opties_gezien&&pa.opties_gezien.length) doc.fontSize(8).fill(TXT3).text("Herkende opties: "+pa.opties_gezien.join(", "),52,yi+56,{width:PW-30})
        
        yi += 82
      }
      
      // ── FOTO'S ──
      if (ext.photos) {
        const photoDir = path.join("/opt/t4c/data/photos/inspections", ext.photos)
        if (fs.existsSync(photoDir)) {
          const files = fs.readdirSync(photoDir).filter(f=>f.endsWith(".jpg")).sort().slice(0,6)
          if (files.length > 0) {
            // Check of foto's nog op deze pagina passen
            if (yi > 500) {
              doc.fontSize(7).fill(TXT3).text("Foto-analyse uitgevoerd door CarDatax Vision.",40,790,{width:PW})
              footer(doc)
              doc.addPage({size:"A4",margin:40})
              doc.rect(0,0,595,842).fill(DARK)
              try { doc.image(logoLg,40,28,{height:28}) } catch(e){}
              doc.fontSize(10).fill(TXT3).text("INSPECTIE FOTO'S",440,35,{width:115,align:"right"})
              doc.save().strokeOpacity(0.15).moveTo(40,62).lineTo(40+PW,62).strokeColor(ACCENT).stroke().restore()
              yi = 75
            }
            
            doc.save().roundedRect(40,yi,PW,18,6).fill("#111520").restore()
            doc.fontSize(8).fill(ACCENT).text("INSPECTIE FOTO'S ("+files.length+")",52,yi+5)
            yi += 24
            
            const cols = files.length <= 4 ? 2 : 3
            const gap = 8
            const imgW = (PW - (cols-1)*gap) / cols
            const imgH = imgW * 0.65
            
            for (let i = 0; i < files.length; i++) {
              const col = i % cols
              const row = Math.floor(i / cols)
              const x = 40 + col * (imgW + gap)
              const y = yi + row * (imgH + gap)
              
              try {
                const imgPath = path.join(photoDir, files[i])
                doc.save()
                doc.roundedRect(x,y,imgW,imgH,4).clip()
                doc.image(imgPath, x, y, { width: imgW, height: imgH, fit: [imgW, imgH], align: "center", valign: "center" })
                doc.restore()
                doc.roundedRect(x,y,imgW,imgH,4).strokeColor(TXT3).strokeOpacity(0.2).stroke()
                // Label
                doc.roundedRect(x+4,y+4,28,14,3).fill("rgba(0,0,0,0.6)")
                doc.fontSize(7).fill("#fff").text((i+1)+"/"+files.length,x+6,y+7,{lineBreak:false})
              } catch(e) {}
            }
          }
        }
      }
      
      doc.fontSize(7).fill(TXT3).text("Foto-analyse uitgevoerd door CarDatax Vision. Schade-beoordeling is indicatief en vervangt geen fysieke inspectie.",40,790,{width:PW})
      footer(doc)
    }

    doc.end()
  } catch(e) {
    console.error("[PDF] Error:",e)
    res.status(500).json({error:"PDF generation failed: "+e.message})
  }
})



/* ── KNOWN ISSUES / AANDACHTSPUNTEN ───────── */


module.exports = router
