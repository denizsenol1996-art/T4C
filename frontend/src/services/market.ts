export type Insight = {
  type: "positive" | "warning" | "info"
  icon: string
  text: string
}

export type Intelligence = {
  season: { factor: number; reason: string | null; month: number }
  seasonAdj: { adjustedMedian: number; adjustedAvg: number; factor: number; reason: string } | null
  depreciation: { firstPrice: number; lastPrice: number; change: number; changePct: number; monthlyRate: number; dataPoints: number; periodDays: number; trend: string } | null
  marketPressure: { pressure: string; score: number; advice: string }
  kmNorm: { expectedKm: number; actualKm: number; diff: number; adjustment: number; normalizedPrice: number; verdict: string; avgPerYear: number | null } | null
  insights: Insight[]
}

export type MarketData = {
  avg: number
  median: number
  low: number
  high: number
  count: number
  prices: number[]
  p10?: number
  p25?: number
  p75?: number
  p90?: number
  sources?: Record<string, number>
  searchUrls?: { name: string; icon: string; url: string }[]
  listings?: { title: string; price: number; km: number|null; year: number|null; url: string; source: string }[]
  trimMatch?: {
    trimPrices: number
    broadPrices: number
    searchTrim: string
    searchBroad: string
  }
  validation?: {
    quality: string
    cv: number
    removed: number
    totalScraped: number
  }
  intelligence?: Intelligence
}

export async function fetchMarket(
  make: string,
  model: string,
  year: number,
  km?: number,
  subModel?: string,
  bodyType?: string,
  fuel?: string
): Promise<MarketData> {
  let url = `/api/market?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&year=${year}`
  if (km && km > 0) url += `&km=${km}`
  if (subModel) url += `&sub=${encodeURIComponent(subModel)}`
  if (bodyType) url += `&body=${encodeURIComponent(bodyType)}`
  if (fuel) url += `&fuel=${encodeURIComponent(fuel)}`

  // Try up to 2 times - if first attempt returns 0, wait and retry
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error("Market scraper error")
      const data: MarketData = await res.json()
      if (data.count > 0) return data
      // Got 0 results, wait 2s and retry
      if (attempt === 0) {
        console.log("[T4C] Market returned 0, retrying in 2s...")
        await new Promise(r => setTimeout(r, 2000))
      }
    } catch (e) {
      if (attempt === 0) {
        console.log("[T4C] Market fetch failed, retrying in 2s...")
        await new Promise(r => setTimeout(r, 2000))
      } else {
        throw e
      }
    }
  }

  // Return empty after retries
  return { avg: 0, median: 0, low: 0, high: 0, count: 0, prices: [] }
}
