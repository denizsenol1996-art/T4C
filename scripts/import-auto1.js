// Veilige AUTO1 ground-truth importer. GEEN koppeling/scrape — leest handmatig geplakte order-history.
const fs=require('fs');
const Database=require('/opt/t4c/backend/node_modules/better-sqlite3');
const db=new Database('/opt/t4c/data/groundtruth/auto1_purchases.db');
db.exec(`CREATE TABLE IF NOT EXISTS auto1_purchases(
  stock_id TEXT PRIMARY KEY, title TEXT, make TEXT, model TEXT, variant TEXT,
  purchase_price REAL, purchase_date TEXT, transport_cost REAL,
  location TEXT, country TEXT, raw TEXT, imported_at TEXT)`);
const price=s=>parseFloat(s.replace(/\./g,'').replace(',','.'));
const date=d=>{const m=(d||'').match(/(\d{2})-(\d{2})-(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:null;};
const clean=t=>(t||'').replace(/^(complete|GEEF FEEDBACK)+/i,'').trim();
const up=db.prepare(`INSERT INTO auto1_purchases(stock_id,title,make,model,variant,purchase_price,purchase_date,transport_cost,location,country,raw,imported_at)
 VALUES(@stock_id,@title,@make,@model,@variant,@purchase_price,@purchase_date,@transport_cost,@location,@country,@raw,@imported_at)
 ON CONFLICT(stock_id) DO UPDATE SET title=@title,make=@make,model=@model,variant=@variant,purchase_price=@purchase_price,purchase_date=@purchase_date,transport_cost=@transport_cost,location=@location,country=@country,raw=@raw,imported_at=@imported_at`);
let total=0;
for(const file of process.argv.slice(2)){
  const L=fs.readFileSync(file,'utf8').split('\n').map(l=>l.trim());
  const idx=[]; L.forEach((l,i)=>{if(l.startsWith('Stock ID:'))idx.push(i);});
  for(let k=0;k<idx.length;k++){
    const i=idx[k], end=(k+1<idx.length)?idx[k+1]-1:L.length-1;
    const stock_id=L[i].replace('Stock ID:','').trim();
    const title=clean(L[i-1]);
    const blk=L.slice(i,end+1).join('\n');
    const bm=blk.match(/Auto betaling:\s*€\s*([\d.,]+)/);
    const tm=blk.match(/Transport betaling:\s*€\s*([\d.,]+)/);
    const ai=L.slice(i,end+1).findIndex(l=>l==='Aankoopdatum');
    const purchase_date=ai>=0?date(L[i+ai+1]):null;
    const cm=blk.match(/\b([A-Z]{2})PR\d{4,}/) || blk.match(/\b(DE|FR|NL|BE|AT|ES|IT|PL)\b/);
    const ll=L.slice(i,end+1).find(l=>l.startsWith('Locatie auto:'));
    const p=title.split(' ');
    up.run({stock_id,title,make:p[0]||'',model:p[1]||'',variant:p.slice(2).join(' '),
      purchase_price:bm?price(bm[1]):null, purchase_date,
      transport_cost:tm?price(tm[1]):null, location:ll?ll.replace('Locatie auto:','').trim():null,
      country:cm?cm[1]:null, raw:blk, imported_at:'2026-06-14'});
    total++;
  }
}
console.log('records verwerkt:',total);
const n=db.prepare('SELECT COUNT(*) n FROM auto1_purchases').get().n;
console.log('UNIEKE auto\x27s in DB (ontdubbeld op stock_id):',n);
console.log('\nper land:');
console.table(db.prepare("SELECT country as land, COUNT(*) n, ROUND(AVG(purchase_price)) gem_prijs, MIN(purchase_price) min, MAX(purchase_price) max FROM auto1_purchases GROUP BY country ORDER BY n DESC").all());
console.log('prijsklasse-verdeling:');
console.table(db.prepare("SELECT CASE WHEN purchase_price<5000 THEN '<5k' WHEN purchase_price<10000 THEN '5-10k' WHEN purchase_price<15000 THEN '10-15k' ELSE '15k+' END klasse, COUNT(*) n FROM auto1_purchases GROUP BY 1").all());
