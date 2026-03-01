export type FinnikVehicle = {
  catalogPrice?: number
}

export async function fetchFinnik(plate: string): Promise<FinnikVehicle | null> {
  try {
    const res = await fetch(`https://finnik.nl/kenteken/${plate}`)
    const html = await res.text()
    const m = html.match(/Catalogusprijs[^€]*€\s?([\d\.\,]+)/i)
    let catalogPrice: number | undefined
    if (m?.[1]) catalogPrice = Number(m[1].replace(/\./g, "").replace(",", "."))
    return { catalogPrice }
  } catch { return null }
}
