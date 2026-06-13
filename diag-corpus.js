// T4C corpus diagnose — fuel types, hybrid coverage, listing quality
const { queryAll, queryOne } = require('./backend/db');

console.log('=== 1. LISTINGS PER FUEL TYPE ===');
const fuels = queryAll(`
  SELECT
    CASE
      WHEN LOWER(fuel) LIKE '%hybri%' THEN 'hybride'
      WHEN LOWER(fuel) LIKE '%diesel%' THEN 'diesel'
      WHEN LOWER(fuel) LIKE '%benzine%' OR LOWER(fuel) LIKE '%petrol%' THEN 'benzine'
      WHEN LOWER(fuel) LIKE '%elektr%' OR LOWER(fuel) LIKE '%electric%' THEN 'elektrisch'
      WHEN LOWER(fuel) LIKE '%lpg%' THEN 'lpg'
      WHEN fuel IS NULL OR fuel = '' THEN 'GEEN_FUEL'
      ELSE 'overig'
    END as fuel_cat,
    COUNT(*) as cnt,
    COUNT(DISTINCT make) as merken
  FROM market_listings
  WHERE status='active' AND price > 0
  GROUP BY fuel_cat
  ORDER BY cnt DESC
`);
fuels.forEach(r => console.log('  ' + r.fuel_cat + ': ' + r.cnt + ' listings (' + r.merken + ' merken)'));

const total = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE status='active' AND price > 0");
console.log('  TOTAAL: ' + total.c);
const noFuel = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE status='active' AND price > 0 AND (fuel IS NULL OR fuel='')");
console.log('  ZONDER FUEL: ' + noFuel.c + ' (' + Math.round(noFuel.c / total.c * 100) + '%)');

console.log('');
console.log('=== 2. HYBRIDE LISTINGS PER MERK ===');
const hybridMerken = queryAll(`
  SELECT make, model, COUNT(*) as cnt,
    ROUND(AVG(price)) as avg_price,
    MIN(year) as min_yr, MAX(year) as max_yr
  FROM market_listings
  WHERE status='active' AND price > 0
    AND LOWER(fuel) LIKE '%hybri%'
  GROUP BY make, model
  ORDER BY cnt DESC
  LIMIT 25
`);
hybridMerken.forEach(r => console.log('  ' + r.make + ' ' + r.model + ': ' + r.cnt + ' (avg EUR' + r.avg_price + ', ' + r.min_yr + '-' + r.max_yr + ')'));

console.log('');
console.log('=== 3. TOYOTA YARIS LISTINGS (alle fuels) ===');
const yarisAll = queryAll(`
  SELECT fuel, COUNT(*) as cnt, ROUND(AVG(price)) as avg_price, ROUND(AVG(km)) as avg_km
  FROM market_listings
  WHERE status='active' AND price > 0
    AND LOWER(make)='toyota' AND LOWER(model) LIKE '%yaris%'
  GROUP BY fuel
  ORDER BY cnt DESC
`);
yarisAll.forEach(r => console.log('  fuel=' + (r.fuel || 'NULL') + ': ' + r.cnt + ' listings (avg EUR' + r.avg_price + ', avg ' + r.avg_km + ' km)'));

console.log('');
console.log('=== 4. TOYOTA YARIS HYBRID LISTINGS (detail) ===');
const yarisHybrid = queryAll(`
  SELECT title, price, km, year, fuel, source, transmission
  FROM market_listings
  WHERE status='active' AND price > 0
    AND LOWER(make)='toyota' AND LOWER(model) LIKE '%yaris%'
    AND LOWER(fuel) LIKE '%hybri%'
  ORDER BY price ASC
  LIMIT 20
`);
yarisHybrid.forEach((r, i) => console.log('  #' + (i+1) + ' EUR' + r.price + ' | ' + r.km + 'km | ' + r.year + ' | ' + (r.fuel || '-') + ' | ' + (r.transmission || '-') + ' | ' + (r.source || '-') + ' | ' + (r.title || '').substring(0, 60)));

console.log('');
console.log('=== 5. LISTINGS MET TITLE MAAR ZONDER FUEL-DETECTIE (sample) ===');
const noFuelSample = queryAll(`
  SELECT title, price, km, year, source, make, model
  FROM market_listings
  WHERE status='active' AND price > 0 AND (fuel IS NULL OR fuel='')
    AND LOWER(make)='toyota' AND LOWER(model) LIKE '%yaris%'
  ORDER BY price DESC
  LIMIT 10
`);
console.log('  Toyota Yaris zonder fuel:');
noFuelSample.forEach((r, i) => console.log('  #' + (i+1) + ' EUR' + r.price + ' | ' + r.km + 'km | ' + r.year + ' | ' + (r.source || '-') + ' | ' + (r.title || '').substring(0, 70)));

console.log('');
console.log('=== 6. TOP 10 MERKEN TOTAAL vs HYBRIDE vs GEEN-FUEL ===');
const topMerken = queryAll(`
  SELECT make,
    COUNT(*) as total,
    SUM(CASE WHEN LOWER(fuel) LIKE '%hybri%' THEN 1 ELSE 0 END) as hybrid,
    SUM(CASE WHEN fuel IS NULL OR fuel='' THEN 1 ELSE 0 END) as no_fuel
  FROM market_listings
  WHERE status='active' AND price > 0
  GROUP BY make
  ORDER BY total DESC
  LIMIT 15
`);
console.log('  merk          | totaal | hybride | geen_fuel | hybr% | geen%');
topMerken.forEach(r => {
  const hp = r.total > 0 ? Math.round(r.hybrid / r.total * 100) : 0;
  const np = r.total > 0 ? Math.round(r.no_fuel / r.total * 100) : 0;
  console.log('  ' + (r.make || '?').padEnd(15) + ' | ' + String(r.total).padStart(6) + ' | ' + String(r.hybrid).padStart(7) + ' | ' + String(r.no_fuel).padStart(9) + ' | ' + String(hp).padStart(4) + '% | ' + String(np).padStart(4) + '%');
});
