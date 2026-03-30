// T4C Scrapers — 50+ sources across 8 tiers
const { ua, safeFetch, parsePrice, extractPrices, extractListings, MIN_PRICE, MAX_PRICE, maxPrice } = require("./helpers")

// ═══ TIER 1: NL PRIMARY ═══
async function scrapeMarktplaats(mk,ml,yr,c,km,trans){
  const kmQ=km>0?`+${Math.round(km/1000)}km`:""
  const transQ=trans==='automaat'?'+automaat':trans==='handgeschakeld'?'+handgeschakeld':""
  return[...new Set(extractPrices(await safeFetch(`https://www.marktplaats.nl/q/${mk}+${ml}+${yr}${kmQ}${transQ}/`),c))]
}
async function scrapeAutoScout24NL(mk,ml,yr,c,km,trans){
  let url=`https://www.autoscout24.nl/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&cy=NL&sort=price&desc=0&priceto=${c}`
  if(km>0){url+=`&kmfrom=${Math.max(0,Math.round(km*0.6/1000)*1000)}&kmto=${Math.round(km*1.4/1000)*1000}`}
  if(trans==='automaat')url+='&gear=A'
  else if(trans==='handgeschakeld')url+='&gear=M'
  return extractPrices(await safeFetch(url),c)
}
async function scrapeAutoTrack(mk,ml,yr,c){
  const base=`https://www.autotrack.nl/aanbod?merk=${mk}&model=${ml}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`
  const all=new Set()
  for(let page=1;page<=20;page++){
    const url=base+(page>1?`&pagina=${page}`:'')
    const prices=extractPrices(await safeFetch(url),c)
    const before=all.size
    prices.forEach(p=>all.add(p))
    if(prices.length<3||all.size===before)break
    await new Promise(r=>setTimeout(r,800+Math.random()*1500))
  }
  return[...all]
}
async function scrapeGaspedaal(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  const urls=[`https://www.gaspedaal.nl/${m}-${d}/jaar-${yr}`,`https://www.gaspedaal.nl/${m}/${d}?year=${yr}`,`https://www.gaspedaal.nl/zoeken?q=${m}+${d}+${yr}`]
  const all=new Set()
  for(const baseUrl of urls){
    for(let page=1;page<=10;page++){
      const url=baseUrl+(baseUrl.includes('?')?`&page=${page}`:`?page=${page}`)
      const prices=extractPrices(await safeFetch(url),c)
      const before=all.size
      prices.forEach(p=>all.add(p))
      if(prices.length<3||all.size===before)break
      await new Promise(r=>setTimeout(r,800+Math.random()*1500))
    }
    if(all.size>0)break
  }
  return[...all]
}
async function scrapeAutowereld(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  const urls=[`https://www.autowereld.nl/${m}/${m}-${d}/b_${yr}`,`https://www.autowereld.nl/${m}/${d}/b_${yr}`]
  const all=new Set()
  for(const baseUrl of urls){
    for(let page=1;page<=10;page++){
      const url=baseUrl+(page>1?`/p_${page}`:'')
      const prices=extractPrices(await safeFetch(url),c)
      const before=all.size
      prices.forEach(p=>all.add(p))
      if(prices.length<3||all.size===before)break
      await new Promise(r=>setTimeout(r,800+Math.random()*1500))
    }
    if(all.size>0)break
  }
  return[...all]
}
async function scrapeViaBovag(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  const urls=[`https://www.viabovag.nl/auto/merk-${m}/model-${d}?bouwjaarVan=${yr}&bouwjaarTot=${yr+1}`,`https://www.viabovag.nl/auto?merk=${m}&model=${d}&bouwjaarVan=${yr}&bouwjaarTot=${yr+1}`]
  const all=new Set()
  for(const baseUrl of urls){
    for(let page=1;page<=10;page++){
      const url=baseUrl+`&pagina=${page}`
      const prices=extractPrices(await safeFetch(url),c)
      const before=all.size
      prices.forEach(p=>all.add(p))
      if(prices.length<3||all.size===before)break
      await new Promise(r=>setTimeout(r,800+Math.random()*1500))
    }
    if(all.size>0)break
  }
  return[...all]
}

// ═══ TIER 2: NL SECONDARY ═══
async function scrapeAutoWeek(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autoweek.nl/occasions/?merk=${m}&model=${d}&bouwjaarvan=${yr}&bouwjaartm=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autoweek.nl/occasions/?q=${m}+${d}+${yr}`),c)
  return p
}
async function scrapeAutosNL(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autos.nl/${m}/${d}/?bouwjaar=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autos.nl/zoeken/?merk=${m}&model=${d}&bouwjaarvan=${yr}&bouwjaartm=${yr}`),c)
  return p
}
async function scrapeAutoGids(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autogids.nl/tweedehands/${m}/${d}?year_min=${yr}&year_max=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autogids.nl/zoeken?q=${m}+${d}+${yr}`),c)
  return p
}
async function scrapeDealerOccasions(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.dealeroccasions.nl/${m}/${d}/?bouwjaar=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.dealeroccasions.nl/zoeken/?merk=${m}&model=${d}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
  return p
}
async function scrapeAutoBedrijven(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  return extractPrices(await safeFetch(`https://www.autobedrijven.nl/occasions/${m}/${d}/?bouwjaar=${yr}`),c)
}
async function scrapeAutoBedrijf24(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  return extractPrices(await safeFetch(`https://www.autobedrijf24.nl/aanbod/${m}/${d}/?bouwjaar=${yr}`),c)
}
async function scrapeAutoKopen(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autokopen.nl/${m}/${d}/?bouwjaar=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autokopen.nl/zoeken?merk=${m}&model=${d}&jaar=${yr}`),c)
  return p
}
async function scrapeAutoDealers(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autodealers.nl/occasions?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}
async function scrapeAutoWerk(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  return extractPrices(await safeFetch(`https://www.autowerk.nl/occasions/${m}/${d}/?bouwjaar=${yr}`),c)
}
async function scrapeVakgarage(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.vakgarage.nl/occasions?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeAutoBedrijfNL(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autobedrijf.nl/occasions?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}

// ═══ TIER 3: INTERNATIONAL ═══
async function scrapeMobileDE(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://suchen.mobile.de/fahrzeuge/search.html?dam=0&isSearchRequest=true&ms=${m};${d}&fr=${yr}:${yr+1}&ml=:150000&s=Automobile&sb=p&vc=Car`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.mobile.de/nl/auto/${m}/${d}/vhc:car,pgn:1,pgs:50,frn:${yr},frx:${yr+1},srt:price,sro:asc`),c)
  return p
}
async function scrapeAutoScout24DE(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoscout24.de/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&sort=price&desc=0&priceto=${c}`),c)
}
async function scrapeAutoScout24BE(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoscout24.be/nl/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&cy=B&sort=price&desc=0&priceto=${c}`),c)
}
async function scrape2eHandsBE(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  return extractPrices(await safeFetch(`https://www.2dehands.be/l/auto-s/${m}-${d}/q/${m}+${d}+${yr}/`),c)
}
async function scrapeAutoScout24COM(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoscout24.com/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&sort=price&desc=0&priceto=${c}`),c)
}
async function scrapeLeBonCoin(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.leboncoin.fr/recherche?category=2&text=${mk.toLowerCase()}+${ml.toLowerCase()}&regdate=${yr}-${yr+1}`),c)
}

// ═══ TIER 4: AUCTION / WHOLESALE ═══
async function scrapeAutoVeiling(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoveiling.nl/zoeken?q=${mk.toLowerCase()}+${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}
async function scrapeBCA(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.bca.com/nl-NL/search?make=${mk.toLowerCase()}&model=${ml.toLowerCase()}&yearFrom=${yr}&yearTo=${yr}`),c)
}
async function scrapeOpenLane(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.openlane.eu/nl/zoeken?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}
async function scrapeAdesaEU(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.adesa.eu/nl/vehicles?make=${mk.toLowerCase()}&model=${ml.toLowerCase()}&year=${yr}`),c)
}
async function scrapeCopart(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.copart.nl/lotSearchResults/?free=true&query=${mk.toLowerCase()}+${ml.toLowerCase()}+${yr}`),c)
}
async function scrapeAutoBidDE(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autobid.de/nl/zoeken?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}

// ═══ TIER 5: SEARCH ENGINES — DE CHATGPT METHODE ═══
// Zoek via Google/Bing en vind prijzen over ALLE websites tegelijk
async function scrapeGoogleSearch(mk,ml,yr,c){
  const q=encodeURIComponent(`${mk} ${ml} ${yr} te koop prijs €`)
  const urls=[
    `https://www.google.nl/search?q=${q}&num=40&hl=nl`,
    `https://www.google.com/search?q=${encodeURIComponent(`${mk} ${ml} ${yr} occasion kopen`)}&num=30&hl=nl`,
  ]
  let all=[]
  for(const u of urls){
    const html=await safeFetch(u)
    if(html) all.push(...extractPrices(html,c))
  }
  return all
}
async function scrapeBingSearch(mk,ml,yr,c){
  const q=encodeURIComponent(`${mk} ${ml} ${yr} te koop occasion prijs`)
  const html=await safeFetch(`https://www.bing.com/search?q=${q}&count=50&cc=NL&setlang=nl`)
  return html?extractPrices(html,c):[]
}
async function scrapeDuckDuckGo(mk,ml,yr,c){
  const q=encodeURIComponent(`${mk} ${ml} ${yr} te koop prijs euro`)
  const html=await safeFetch(`https://html.duckduckgo.com/html/?q=${q}`)
  return html?extractPrices(html,c):[]
}
async function scrapeEcosia(mk,ml,yr,c){
  const q=encodeURIComponent(`${mk} ${ml} ${yr} occasion prijs`)
  const html=await safeFetch(`https://www.ecosia.org/search?q=${q}`)
  return html?extractPrices(html,c):[]
}

// ═══ TIER 6: DEALER GROUPS ═══
async function scrapeVanMossel(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autobedrijfvanmossel.nl/occasions/?merk=${m}&model=${d}&bouwjaarvan=${yr}&bouwjaartot=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autobedrijfvanmossel.nl/occasions/${m}/${d}/`),c)
  return p
}
async function scrapeLouwman(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.louwman.nl/occasions/?merk=${m}&model=${d}&bouwjaarvan=${yr}&bouwjaartot=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.louwman.nl/occasions/${m}/${d}/`),c)
  return p
}
async function scrapeWensink(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.wensink.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeBroekhuis(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.broekhuis.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeHerwers(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.herwers.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapePonCenter(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.poncenter.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeZeeuwZeeuw(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.zeeuwenzeeuw.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeTerwolde(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.terwolde.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeStam(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.stam.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeMulder(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.mulder.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeHartgerink(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.hartgerink.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}

// ═══ TIER 7: LEASE OCCASIONS ═══
async function scrapeLeasePlan(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.leaseplanauto.nl/occasions/?merk=${m}&model=${d}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.leaseplan.com/nl-nl/occasion-auto/?make=${m}&model=${d}`),c)
  return p
}
async function scrapeAthlon(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.athlon.com/nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeArval(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.arval.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeAlphabet(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.alphabet.com/nl-nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}

// ═══ TIER 8: EXTRA PLATFORMS ═══
async function scrapeAutoTraderNL(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autotrader.nl/${m}/${d}/?bouwjaar=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autotrader.nl/zoeken/?merk=${m}&model=${d}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
  return p
}
async function scrapeAutoFirstNL(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autofirst.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeBoschCarService(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.boschcarservice.com/nl/nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}
async function scrapeAutoScout24FR(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoscout24.fr/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&sort=price&desc=0&priceto=${c}`),c)
}
async function scrapeAutoTraderUK(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autotrader.co.uk/car-search?make=${mk.toUpperCase()}&model=${ml.toUpperCase()}&year-from=${yr}&year-to=${yr}&sort=price-asc`),c)
}

/* ── SEARCH URLS for listings display ────── */
function buildSearchUrls(mk, ml, yr) {
  const m = mk.toLowerCase(), d = ml.toLowerCase()
  const me = encodeURIComponent(m), de = encodeURIComponent(d)
  return [
    { name: "Marktplaats", icon: "MP", url: `https://www.marktplaats.nl/l/auto-s/#q:${me}+${de}&PriceCentsFrom=0&yearFrom=${yr}&yearTo=${yr+1}` },
    { name: "AutoScout24", icon: "AS", url: `https://www.autoscout24.nl/lst/${m}/${d}?fregfrom=${yr}&fregto=${yr}&cy=NL&sort=standard&desc=0` },
    { name: "AutoTrack", icon: "AT", url: `https://www.autotrack.nl/aanbod?merk=${me}&model=${de}&bouwjaarVan=${yr}&bouwjaarTot=${yr}` },
    { name: "Gaspedaal", icon: "GP", url: `https://www.gaspedaal.nl/${m}/${d}/${yr}` },
    { name: "AutoWereld", icon: "AW", url: `https://www.autowereld.nl/${m}/${d}/?bouwjaar=${yr}` },
    { name: "ViaBovag", icon: "VB", url: `https://www.viabovag.nl/auto/${m}/${d}?bouwjaar=${yr}-${yr}` },
    { name: "AutoWeek", icon: "AK", url: `https://www.autoweek.nl/occasions/?merk=${me}&model=${de}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}` },
    { name: "DealerOccasions", icon: "DO", url: `https://www.dealeroccasions.nl/${m}/${d}/?bouwjaar=${yr}` },
    { name: "Mobile.de", icon: "DE", url: `https://suchen.mobile.de/fahrzeuge/search.html?dam=0&isSearchRequest=true&ms=${me};${de}&fr=${yr}:${yr+1}&ml=:150000&s=Automobile&sb=p&vc=Car` },
    { name: "AutoScout24.de", icon: "DE", url: `https://www.autoscout24.de/lst/${m}/${d}?fregfrom=${yr}&fregto=${yr+1}&sort=price&desc=0` },
    { name: "2dehands.be", icon: "BE", url: `https://www.2dehands.be/l/auto-s/${m}-${d}/q/${m}+${d}+${yr}/` },
  ]
}

/* ── VALIDATION ──────────────────────────── */
function med(a){if(!a.length)return 0;const s=[...a].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function validate(prices,yr,mk){
  const cap=maxPrice(yr,mk);let p=prices.filter(x=>x>=MIN_PRICE&&x<=cap)
  if(p.length<2)return{v:p,rm:prices.length-p.length,q:p.length?"low":"none",cv:0}
  const m1=med(p);p=p.filter(x=>x>=m1*.25&&x<=m1*2.5)
  if(p.length>=6){const s=[...p].sort((a,b)=>a-b);const q1=s[Math.floor(s.length*.25)],q3=s[Math.floor(s.length*.75)],iq=q3-q1;p=p.filter(x=>x>=q1-1.5*iq&&x<=q3+1.5*iq)}
  const md=med(p);const sd=p.length>1?Math.sqrt(p.reduce((s,v)=>s+(v-md)**2,0)/p.length):0;const cv=md>0?Math.round(sd/md*100)/100:1
  let q="low";if(p.length>=15&&cv<.25)q="excellent";else if(p.length>=8&&cv<.35)q="good";else if(p.length>=4&&cv<.50)q="fair"
  return{v:p,rm:prices.length-p.length,q,cv}
}

/* ── MARKET ──────────────────────────────── */

module.exports = {
  scrapeMarktplaats, scrapeAutoScout24NL, scrapeAutoTrack, scrapeGaspedaal,
  scrapeAutowereld, scrapeViaBovag, scrapeAutoWeek, scrapeAutosNL,
  scrapeAutoGids, scrapeDealerOccasions, scrapeAutoBedrijven, scrapeAutoBedrijf24,
  scrapeAutoKopen, scrapeAutoDealers, scrapeAutoWerk, scrapeVakgarage, scrapeAutoBedrijfNL,
  scrapeMobileDE, scrapeAutoScout24DE, scrapeAutoScout24BE, scrape2eHandsBE,
  scrapeAutoScout24COM, scrapeLeBonCoin,
  scrapeAutoVeiling, scrapeBCA, scrapeOpenLane, scrapeAdesaEU, scrapeCopart, scrapeAutoBidDE,
  scrapeGoogleSearch, scrapeBingSearch, scrapeDuckDuckGo, scrapeEcosia,
  scrapeVanMossel, scrapeLouwman, scrapeWensink, scrapeBroekhuis, scrapeHerwers,
  scrapePonCenter, scrapeZeeuwZeeuw, scrapeTerwolde, scrapeStam, scrapeMulder, scrapeHartgerink,
  scrapeLeasePlan, scrapeAthlon, scrapeArval, scrapeAlphabet,
  scrapeAutoTraderNL, scrapeAutoFirstNL, scrapeBoschCarService, scrapeAutoScout24FR, scrapeAutoTraderUK,
  buildSearchUrls, med, validate
}
