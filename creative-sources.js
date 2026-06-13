// Creatieve bronnen: platforms die WEL bereikbaar zijn
const { safeFetch, extractPrices } = require('./backend/lib/helpers');

async function testSource(name, url, expectJson) {
  try {
    const resp = await fetch(url, {
      headers: {
        'Accept': expectJson ? 'application/json' : 'text/html',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Accept-Language': 'nl-NL',
      },
      redirect: 'follow',
    });
    const ct = resp.headers.get('content-type') || '';
    const body = await resp.text();
    const isJson = ct.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[');
    const prices = isJson ? (body.match(/"price"\s*:\s*\d+/g) || []).length : 0;
    const euroPrices = (body.match(/€\s*[\d.,]+/g) || []).filter(e => { const n = parseInt(e.replace(/[€\s.,]/g,'')); return n >= 2000 && n <= 100000; }).length;
    const htmlPrices = !isJson ? extractPrices(body, 50000).length : 0;

    const status = (prices > 0 || euroPrices > 0 || htmlPrices > 0) ? 'DATA' : (resp.status === 200 ? 'no_prices' : 'http_' + resp.status);
    console.log((status === 'DATA' ? '✓' : '○') + ' ' + name.padEnd(30) + status.padEnd(12) + (isJson ? 'JSON' : 'HTML').padEnd(5) + ' prices:' + (prices||euroPrices||htmlPrices) + ' size:' + body.length);
    return { name, status, prices: prices || euroPrices || htmlPrices, isJson };
  } catch (e) {
    console.log('✗ ' + name.padEnd(30) + e.message.substring(0, 50));
    return { name, status: 'error' };
  }
}

(async () => {
  console.log('=== CREATIEVE BRONNEN ZOEKTOCHT ===\n');
  console.log('Doel: vindbare APIs + nieuwe platforms met auto-data\n');

  // 1. Hexon API (dealer management systeem — bijna alle NL dealers gebruiken dit)
  await testSource('Hexon XML feed', 'https://xml.hexon.nl/api/v1/vehicles?limit=10', true);
  await testSource('Hexon occasions', 'https://www.hexonet.nl/occasions/volkswagen/golf', false);

  // 2. VWE/RDW gerelateerd
  await testSource('RDW open data', 'https://opendata.rdw.nl/resource/m9d7-ebf2.json?$where=merk=%27VOLKSWAGEN%27%20AND%20handelsbenaming=%27GOLF%27&$limit=5', true);

  // 3. Bekende aggregator APIs
  await testSource('Carpages.nl', 'https://www.carpages.nl/occasions/volkswagen/golf/', false);
  await testSource('Autovisie occasions', 'https://occasions.autovisie.nl/volkswagen/golf', false);
  await testSource('ANWB occasions', 'https://www.anwb.nl/auto/occasions/volkswagen/golf', false);
  await testSource('Bovag.nl', 'https://www.bovag.nl/auto-kopen?merk=volkswagen&model=golf', false);
  await testSource('Nettiauto.com NL', 'https://www.nettiauto.com/en/volkswagen/golf?country=NL', false);

  // 4. Dealer platform feeds
  await testSource('Stockbase.nl', 'https://www.stockbase.nl/occasions?make=volkswagen&model=golf', false);
  await testSource('Occasion.nl', 'https://www.occasion.nl/volkswagen/golf/', false);
  await testSource('Tweedehands-auto', 'https://www.tweedehands-auto.nl/volkswagen/golf/', false);
  await testSource('Autoscout24 API', 'https://www.autoscout24.nl/lst/volkswagen/golf?fregfrom=2020&fregto=2020&cy=NL&atype=C&desc=0&sort=standard&source=listpage_search', false);

  // 5. Veiling/inkoop platforms
  await testSource('Autobid.de', 'https://www.autobid.de/en/search?make=volkswagen&model=golf', false);
  await testSource('Adesa EU', 'https://www.adesaeurope.com/en/search?make=Volkswagen&model=Golf', false);
  await testSource('CarNext', 'https://www.carnext.com/nl-nl/auto/volkswagen/golf', false);

  // 6. Prijs-vergelijkers
  await testSource('Independer auto', 'https://www.independer.nl/auto/occasions/volkswagen/golf', false);
  await testSource('Autocompare.nl', 'https://www.autocompare.nl/volkswagen/golf/', false);

  // 7. Google structured data
  await testSource('Google Shopping NL', 'https://www.google.nl/search?q=volkswagen+golf+2020+occasion+te+koop&tbm=shop', false);

  console.log('\n=== KLAAR ===');
})();
