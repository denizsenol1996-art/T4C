// T4C Formula Fallback — deterministic pricing when GPT unavailable
function detectSegment(make) {
  const m = (make || "").toUpperCase()
  if (["BMW","MERCEDES","AUDI","VOLVO","LEXUS","INFINITI","JAGUAR","PORSCHE","MASERATI","ALFA ROMEO","LAND ROVER","TESLA"].includes(m)) return "P"
  if (["BENTLEY","ROLLS","FERRARI","LAMBORGHINI","ASTON","MCLAREN","BUGATTI","MAYBACH"].some(s => m.includes(s))) return "L"
  if (["DACIA","SUZUKI","FIAT","SEAT","SKODA","KIA","HYUNDAI","MITSUBISHI","CHEVROLET","SSANGYONG","MG","LADA"].includes(m)) return "B"
  return "C"
}
const RESIDUAL = {
  L:[.85,.73,.62,.53,.45,.39,.34,.30,.27,.24,.21,.19,.17,.15,.13,.12,.10,.09,.08,.07,.06],
  P:[.78,.65,.54,.45,.38,.32,.28,.24,.21,.18,.16,.14,.12,.11,.10,.09,.08,.07,.06,.05,.04],
  C:[.72,.58,.47,.38,.31,.26,.22,.19,.16,.14,.12,.11,.10,.09,.08,.07,.06,.05,.04,.04,.03],
  B:[.68,.54,.43,.34,.27,.22,.18,.15,.13,.11,.10,.09,.08,.07,.06,.05,.05,.04,.03,.03,.02]
}
function calculateFormulaPrice(d, year, km, age, segOverride) {
  const segment = segOverride || detectSegment(d.make)
  const curve = RESIDUAL[segment] || RESIDUAL.C
  const residualPct = age >= 0 && age < curve.length ? curve[age] : 0.03
  const expectedKm = age * (segment === "L" ? 12000 : segment === "P" ? 18000 : segment === "B" ? 14000 : 16000)
  const kmRatio = expectedKm > 0 ? km / expectedKm : 1
  let kmFactor = kmRatio <= 0.5 ? 1.12 : kmRatio <= 0.7 ? 1.08 : kmRatio <= 0.85 ? 1.03 : kmRatio <= 1.0 ? 1.0 : kmRatio <= 1.15 ? 0.96 : kmRatio <= 1.3 ? 0.90 : kmRatio <= 1.5 ? 0.82 : kmRatio <= 1.75 ? 0.72 : kmRatio <= 2.0 ? 0.62 : kmRatio <= 2.5 ? 0.50 : 0.40
  if (km > 300000) kmFactor *= 0.70
  else if (km > 250000) kmFactor *= 0.80
  else if (km > 200000) kmFactor *= 0.88
  else if (km > 150000) kmFactor *= 0.95
  const catalog = d.catalogPrice || 0
  let base = catalog > 0 ? catalog * residualPct * kmFactor : 0
  const mCenter = (d.marketMedian || 0) > 0 ? d.marketMedian : (d.marketAvg || 0)
  if (mCenter > 0 && base > 0) {
    if (km > 250000) base = base * 0.75 + mCenter * 0.25
    else if (km > 200000) base = base * 0.70 + mCenter * 0.30
    else if (km > 150000) base = base * 0.65 + mCenter * 0.35
    else if (km < 30000) base = base * 0.40 + mCenter * 0.60
    else { const r = mCenter / base; base = r > 1.5 ? base*0.30+mCenter*0.70 : r > 1.2 ? base*0.50+mCenter*0.50 : r < 0.6 ? base*0.30+mCenter*0.70 : r < 0.8 ? base*0.50+mCenter*0.50 : base*0.60+mCenter*0.40 }
  } else if (mCenter > 0 && base === 0) {
    base = mCenter; if (km > 250000) base *= 0.55; else if (km > 200000) base *= 0.68; else if (km > 150000) base *= 0.82
  }
  if (base === 0) base = 3000
  if ((d.ownerCount||0) > 5) base *= 0.92; else if ((d.ownerCount||0) > 3) base *= 0.96
  if (d.importFlag) base *= 0.97
  if (d.transmissionType && d.transmissionType !== 'Onbekend') {
    if (d.transmissionAuto === true) base *= segment === 'P' || segment === 'L' ? 1.08 : segment === 'C' ? 1.05 : 1.03
    else base *= segment === 'P' || segment === 'L' ? 0.92 : segment === 'C' ? 0.95 : 0.97
  }
  if (d.taxiIndicator) base *= 0.78
  const clr = (d.color||'').toUpperCase()
  if (['ZWART','WIT','GRIJS'].includes(clr)) base *= 1.02; else if (['GEEL','ORANJE','PAARS'].includes(clr)) base *= 0.95
  if (d.apkUntil) { try { const dd = new Date(d.apkUntil.split('-').reverse().join('-')); const dl = (dd-new Date())/86400000; if (dl<0) base-=500; else if (dl<60) base-=200 } catch{} }
  if (d.wamInsured === false) base *= 0.95
  if (d.emissieKlasse && String(d.emissieKlasse).match(/euro\s*[0-3]/i)) base *= 0.95
  return { base: Math.round(base), segment, residualPct, kmFactor, kmRatio }
}
module.exports = { calculateFormulaPrice, detectSegment }
