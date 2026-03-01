import { fetchRDW, type VehicleRDW, type ApkRecord } from "./rdw"
import { fetchFinnik } from "./finnik"

export type EnrichedVehicle = VehicleRDW & {
  imageUrl?: string
  fullName: string
  source: { rdw: boolean; finnik: boolean }
}

/* ── Vehicle image from backend proxy ────── */
async function fetchImage(make: string, model: string, year: number): Promise<string> {
  try {
    const res = await fetch(`/api/image?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&year=${year}`)
    if (!res.ok) return ""
    const data = await res.json()
    return data.url || ""
  } catch { return "" }
}

export async function fetchVehicleEnriched(plate: string): Promise<EnrichedVehicle> {
  const rdw = await fetchRDW(plate)

  // Finnik for extra catalog price
  let finnik = null
  try { finnik = await fetchFinnik(plate) } catch {}

  // Override catalog if Finnik has it and RDW doesn't
  if (!rdw.catalogPrice && finnik?.catalogPrice) {
    rdw.catalogPrice = finnik.catalogPrice
  }

  // Get image
  const imageUrl = await fetchImage(rdw.make, rdw.model, rdw.year)

  const fullName = [
    rdw.make,
    rdw.model !== rdw.make ? rdw.model : "",
    rdw.modelVariant || (rdw.trim !== rdw.model ? rdw.trim : ""),
  ].filter(Boolean).join(" ")

  return {
    ...rdw,
    imageUrl,
    fullName,
    source: { rdw: true, finnik: !!finnik?.catalogPrice },
  }
}

export type { ApkRecord }
