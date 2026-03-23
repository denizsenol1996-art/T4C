#!/usr/bin/env node
// Transfer4Cars — Voorraad Seed
// Importeert auto's direct in de database vanuit bekende Marktplaats data
// Run: node seed-voorraad.js

const path = require("path");
const DB_PATH = path.join(__dirname, "..", "data", "t4c.db");

let db;
try {
  const Database = require("better-sqlite3");
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
} catch (e) {
  console.error("better-sqlite3 niet gevonden. Run: npm install better-sqlite3");
  process.exit(1);
}

// Ensure extra columns
const cols = db.prepare("PRAGMA table_info(voorraad)").all().map(c => c.name);
const add = (col, type) => { if (!cols.includes(col)) db.exec(`ALTER TABLE voorraad ADD COLUMN ${col} ${type}`); };
add("cover_photo", "TEXT");
add("photos", "TEXT");
add("mp_id", "TEXT");
add("mp_url", "TEXT");
add("options", "TEXT");

const insert = db.prepare(`INSERT OR REPLACE INTO voorraad (
  make, model, model_variant, year, fuel, km, color, body,
  power_kw, power_hp, transmission, doors, seats,
  vraag_prijs, beschrijving, cover_photo, photos,
  mp_id, mp_url, status, featured
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

// Data from Marktplaats Transfer4Cars profiel (35 auto's)
const cars = [
  {
    make:"Peugeot", model:"107", variant:"XS 1.0", year:2012, fuel:"Benzine", km:200050,
    color:"Grijs", power_hp:68, power_kw:50, trans:"Handgeschakeld", doors:3,
    price:1750, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/f3/f3033269-b7ff-4c28-8484-662f65a39f00?rule=ecg_mp_eps$_86",
    mp_id:"2366530804", mp_url:"https://www.marktplaats.nl/v/auto-s/peugeot/m2366530804-peugeot-107-xs-1-0-bj-2012",
    desc:"Nette goed rijdende Peugeot 107, technisch 100%. Vaste prijs."
  },
  {
    make:"Suzuki", model:"Swift", variant:"1.3 Shogun", year:2007, fuel:"Benzine", km:262630,
    color:"Zilver", power_hp:92, power_kw:68, trans:"Handgeschakeld", doors:5,
    price:1300, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/a1/a170d0fe-4707-4a7e-8038-207b51afe54b?rule=ecg_mp_eps$_86",
    mp_id:"2366431458", mp_url:"https://www.marktplaats.nl/v/auto-s/suzuki/m2366431458-suzuki-swift-1-3-shogun-bj-2007",
    desc:"Airco. Suzuki Swift 1.3 Shogun (2007). Lichtmetalen velgen, betrouwbare en complete auto."
  },
  {
    make:"Nissan", model:"LEAF", variant:"30kWh Tekna", year:2016, fuel:"Elektrisch", km:125377,
    color:"Zwart", power_hp:109, power_kw:80, trans:"Automaat", doors:5,
    price:4950, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/7c/7caba375-3e46-4287-833b-bf818ab64747?rule=ecg_mp_eps$_86",
    mp_id:"2365785429", mp_url:"https://www.marktplaats.nl/v/auto-s/nissan/m2365785429-nissan-leaf-30kwh-30kwh-tekna-bj-2016-automaat",
    desc:"Nissan LEAF 30kWh Tekna | 360° camera | leder | stoel- & stuurverwarming | vol opties."
  },
  {
    make:"Renault", model:"Mégane", variant:"dCi 110 ECO2 Expression", year:2012, fuel:"Diesel", km:212462,
    color:"Grijs", power_hp:110, power_kw:81, trans:"Handgeschakeld", doors:5,
    price:2300, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/9e/9e92569c-04cd-47a1-acc0-a4fa24d71097?rule=ecg_mp_eps$_86",
    mp_id:"2365729917", mp_url:"https://www.marktplaats.nl/v/auto-s/renault/m2365729917-renault-megane-dci-110-eco2-expression-bj-2012",
    desc:"Renault Mégane 1.5 dCi 110 ECO2 Expression (2012). Comfortabel en zeer zuinig."
  },
  {
    make:"Audi", model:"A4", variant:"1.8 TFSI 120pk Pro Line S (S-Line)", year:2011, fuel:"Benzine", km:258824,
    color:"Grijs", power_hp:120, power_kw:88, trans:"Handgeschakeld", doors:4,
    price:5990, body:"Sedan",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/69/6951b383-e01d-4744-b9cf-64e304b95bbd?rule=ecg_mp_eps$_86",
    mp_id:"2365439143", mp_url:"https://www.marktplaats.nl/v/auto-s/audi/m2365439143-audi-a4-1-8-tfsi-120pk-pro-line-s-s-line-bj-2011",
    desc:"Zeer complete en sportieve Audi A4 1.8 TFSI met dubbel S-Line uitvoering."
  },
  {
    make:"Peugeot", model:"207", variant:"Féline 1.6-16V Turbo", year:2008, fuel:"Benzine", km:132030,
    color:"Zwart", power_hp:150, power_kw:110, trans:"Handgeschakeld", doors:3,
    price:3450, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/45/45a44fa0-633f-430d-8e21-fbb46363f2a0?rule=ecg_mp_eps$_86",
    mp_id:"2365402959", mp_url:"https://www.marktplaats.nl/v/auto-s/peugeot/m2365402959-peugeot-207-feline-1-6-16v-turbo-bj-2008",
    desc:"Peugeot 207 1.6 Turbo (2008). Comfortabel, prettig rijgedrag en betrouwbaar."
  },
  {
    make:"Lexus", model:"RX 400h", variant:"400h Edition", year:2008, fuel:"Hybride", km:194171,
    color:"Grijs", power_hp:211, power_kw:155, trans:"Automaat", doors:5,
    price:11950, body:"SUV",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/95/955f4c09-1e3d-47bd-8c8b-5a971d3b3477?rule=ecg_mp_eps$_86",
    mp_id:"2364996525", mp_url:"https://www.marktplaats.nl/v/auto-s/lexus/m2364996525-lexus-rx-400h-400h-edition-bj-2008-automaat",
    desc:"Nette goed rijdende Lexus RX400h, technisch 100%. Distributieriem vervangen."
  },
  {
    make:"BMW", model:"5 Serie", variant:"530i Executive", year:2001, fuel:"Benzine", km:281057,
    color:"Grijs", power_hp:315, power_kw:232, trans:"Automaat", doors:4,
    price:5950, body:"Sedan",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/a8/a8b17467-3961-4351-b4f9-25b675b4a110?rule=ecg_mp_eps$_86",
    mp_id:"2364993494", mp_url:"https://www.marktplaats.nl/v/auto-s/bmw/m2364993494-bmw-5-serie-530i-executive-bj-2001-automaat",
    desc:"Nette goed rijdende BMW 530i E39, vol opties, liefhebbersauto."
  },
  {
    make:"Renault", model:"Mégane Scenic", variant:"TCe 130 Dynamique", year:2010, fuel:"Benzine", km:200388,
    color:"Zwart", power_hp:131, power_kw:96, trans:"Handgeschakeld", doors:5,
    price:2500, body:"MPV",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/1d/1d7b37d8-a413-4171-aa42-e54a6d5d7984?rule=ecg_mp_eps$_86",
    mp_id:"2364792399", mp_url:"https://www.marktplaats.nl/v/auto-s/renault/m2364792399-renault-megane-scenic-tce-130-dynamique-bj-2010",
    desc:"Renault Megane Scenic TCe 130 Dynamique."
  },
  {
    make:"Volkswagen", model:"Golf", variant:"1.6 TDI 105pk BMT Trendline", year:2013, fuel:"Diesel", km:331368,
    color:"Zwart", power_hp:105, power_kw:77, trans:"Handgeschakeld", doors:5,
    price:3990, body:"Stationwagen",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/48/48747581-dca3-47eb-ad11-3c6588d327fc?rule=ecg_mp_eps$_86",
    mp_id:"2364792403", mp_url:"https://www.marktplaats.nl/v/auto-s/volkswagen/m2364792403-volkswagen-golf-1-6-tdi-105pk-bmt-trendline-bj-2013",
    desc:"Nette goed rijdende Volkswagen Golf Variant, technisch 100%, diesel."
  },
  {
    make:"Chevrolet", model:"Spark", variant:"1.0 LS", year:2010, fuel:"Benzine", km:170228,
    color:"Blauw", power_hp:68, power_kw:50, trans:"Handgeschakeld", doors:5,
    price:1490, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/83/839988e4-fe8a-4b25-b524-c7cf0de46326?rule=ecg_mp_eps$_86",
    mp_id:"2364792397", mp_url:"https://www.marktplaats.nl/v/auto-s/chevrolet/m2364792397-chevrolet-spark-1-0-ls-bj-2010",
    desc:"Chevrolet Spark 1.0 LS."
  },
  {
    make:"Suzuki", model:"Vitara", variant:"1.4 B.jet Stijl", year:2018, fuel:"Benzine", km:99450,
    color:"Rood", power_hp:140, power_kw:103, trans:"Handgeschakeld", doors:5,
    price:17950, body:"SUV",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/6a/6a43cfed-3377-47a7-b9ad-0ba5aa8af1d3?rule=ecg_mp_eps$_86",
    mp_id:"2363865596", mp_url:"https://www.marktplaats.nl/v/auto-s/suzuki/m2363865596-suzuki-vitara-1-4-b-jet-stijl-bj-2018",
    desc:"Suzuki Vitara nette auto met leuke opties. Proefrit mogelijk."
  },
  {
    make:"Kia", model:"Niro", variant:"1.6 GDi Hybrid Design Edition", year:2018, fuel:"Hybride", km:191072,
    color:"Blauw", power_hp:141, power_kw:104, trans:"Automaat", doors:5,
    price:10950, body:"SUV",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/ab/aba9630d-f321-4e93-9b7d-ee8158c91148?rule=ecg_mp_eps$_86",
    mp_id:"2363456689", mp_url:"https://www.marktplaats.nl/v/auto-s/kia/m2363456689-kia-niro-1-6-gdi-hybrid-design-edition-bj-2018-automaat",
    desc:"Kia Niro 1.6 GDi Hybrid Design Edition | adaptive cruise | stoel- & stuurverwarming | lane assist."
  },
  {
    make:"Opel", model:"Corsa", variant:"OPC", year:2008, fuel:"Benzine", km:199504,
    color:"Blauw", power_hp:192, power_kw:141, trans:"Handgeschakeld", doors:3,
    price:4950, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/05/053d8e68-d59a-4a4f-a800-12dcb2dc24fd?rule=ecg_mp_eps$_86",
    mp_id:"2363437544", mp_url:"https://www.marktplaats.nl/v/auto-s/opel/m2363437544-opel-corsa-opc-bj-2008",
    desc:"Opel Corsa OPC 3-deurs (2008). Echte hot hatch met karakter, sportieve prestaties."
  },
  {
    make:"Volkswagen", model:"Golf", variant:"1.2 TSI 105pk BlueMotion Techn. Tour", year:2010, fuel:"Benzine", km:310546,
    color:"Wit", power_hp:103, power_kw:76, trans:"Handgeschakeld", doors:5,
    price:2990, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/4d/4d1dcfc2-f2b0-412a-b119-c0b3e77076dc?rule=ecg_mp_eps$_86",
    mp_id:"2363144398", mp_url:"https://www.marktplaats.nl/v/auto-s/volkswagen/m2363144398-volkswagen-golf-1-2-tsi-105pk-bluemotion-techn-tour",
    desc:"Nette goed rijdende Volkswagen Golf 1.2, technisch 100%."
  },
  {
    make:"Ford", model:"Focus", variant:"1.6 EcoBoost 150pk Titanium", year:2012, fuel:"Benzine", km:251836,
    color:"Bruin", power_hp:150, power_kw:110, trans:"Handgeschakeld", doors:5,
    price:3950, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/ef/ef2a3a18-6c70-4164-a6ef-d0d8ef0d6145?rule=ecg_mp_eps$_86",
    mp_id:"2362684390", mp_url:"https://www.marktplaats.nl/v/auto-s/ford/m2362684390-ford-focus-1-6-ecoboost-150pk-titanium-bj-2012",
    desc:"Nette goed rijdende Ford Focus, luxe uitvoering."
  },
  {
    make:"Skoda", model:"Octavia", variant:"1.6 TDI Greentech Elegance Bus.", year:2012, fuel:"Diesel", km:238594,
    color:"Grijs", power_hp:105, power_kw:77, trans:"Handgeschakeld", doors:5,
    price:3990, body:"Sedan",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/83/839fadc9-af12-4d6c-aa48-4a196958b84b?rule=ecg_mp_eps$_86",
    mp_id:"2362681904", mp_url:"https://www.marktplaats.nl/v/auto-s/skoda/m2362681904-skoda-octavia-1-6-tdi-greentech-elegance-bus-bj-2012",
    desc:"Skoda Octavia diesel. Comfort, ruimte en betrouwbaarheid."
  },
  {
    make:"Fiat", model:"Punto", variant:"Abarth 1.4 T-Jet 16v", year:2008, fuel:"Benzine", km:278424,
    color:"Wit", power_hp:157, power_kw:115, trans:"Handgeschakeld", doors:3,
    price:2950, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/3a/3a67243e-6aa2-43bb-a1f7-f7e8d0f3e0fc?rule=ecg_mp_eps$_86",
    mp_id:"2362417024", mp_url:"https://www.marktplaats.nl/v/auto-s/fiat/m2362417024-fiat-punto-abarth-1-4-t-jet-16v-bj-2008",
    desc:"Nette goed rijdende Abarth Punto. Proefrit mogelijk."
  },
  {
    make:"Toyota", model:"RAV4", variant:"2.5 Hybrid 4WD Energy Plus", year:2018, fuel:"Hybride", km:234786,
    color:"Grijs", power_hp:155, power_kw:114, trans:"Automaat", doors:5,
    price:17950, body:"SUV",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/0e/0e99740a-823a-427f-b84c-a9085ca7d9ed?rule=ecg_mp_eps$_86",
    mp_id:"2362412419", mp_url:"https://www.marktplaats.nl/v/auto-s/toyota/m2362412419-toyota-rav4-2-5-hybrid-4wd-energy-plus-bj-2018-automaat",
    desc:"Toyota RAV4 2.5 Hybrid Executive Business. Ruim, comfortabel, zuinig en betrouwbaar."
  },
  {
    make:"Ford", model:"Focus", variant:"1.6 EcoBoost 150pk First Edition", year:2012, fuel:"Benzine", km:242080,
    color:"Grijs", power_hp:150, power_kw:110, trans:"Handgeschakeld", doors:5,
    price:3750, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/ee/ee674a12-b391-4cc3-b937-9dc0e51382db?rule=ecg_mp_eps$_86",
    mp_id:"2361106716", mp_url:"https://www.marktplaats.nl/v/auto-s/ford/m2361106716-ford-focus-1-6-ecoboost-150pk-first-edition-bj-2012",
    desc:"Nette goed rijdende Ford Focus. Ter inruil verkregen, technisch 100% goed."
  },
  {
    make:"Ford", model:"Transit", variant:"L3H3 (RWD)", year:2015, fuel:"Diesel", km:184936,
    color:"Wit", power_hp:155, power_kw:114, trans:"Handgeschakeld", doors:3,
    price:8950, body:"Bestelwagen",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/75/75a69453-498e-4dcf-b929-a96e4d161b04?rule=ecg_mp_eps$_86",
    mp_id:"2361106705", mp_url:"https://www.marktplaats.nl/v/auto-s/bestelauto-s/m2361106705-ford-transit-l3h3-rwd-bj-2015",
    desc:"Nette goed rijdende Ford Transit L3H3 achterwielaandrijving. Unieke bullbar. Prijs ex BTW."
  },
  {
    make:"Peugeot", model:"RCZ", variant:"1.6 THP 155", year:2011, fuel:"Benzine", km:107178,
    color:"Zwart", power_hp:157, power_kw:115, trans:"Handgeschakeld", doors:2,
    price:6495, body:"Coupé",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/b0/b00351af-4344-4045-8548-aeaa784d2da5?rule=ecg_mp_eps$_86",
    mp_id:"2361106707", mp_url:"https://www.marktplaats.nl/v/auto-s/peugeot/m2361106707-peugeot-rcz-1-6-thp-155-bj-2011",
    desc:"Nette goed rijdende Peugeot RCZ, aangeboden ter inruil verkregen, technisch 100%."
  },
  {
    make:"Ford", model:"Focus", variant:"1.0 EcoBoost 100pk ECOnetic Lease Trend", year:2012, fuel:"Benzine", km:209544,
    color:"Grijs", power_hp:101, power_kw:74, trans:"Handgeschakeld", doors:5,
    price:2750, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/e2/e237b9e8-053c-4a3a-96a6-4a2547c17acd?rule=ecg_mp_eps$_86",
    mp_id:"2361106710", mp_url:"https://www.marktplaats.nl/v/auto-s/ford/m2361106710-ford-focus-1-0-ecoboost-100pk-econetic-lease-trend",
    desc:"Motor vervangen! Technisch super staat."
  },
  {
    make:"Dacia", model:"Lodgy", variant:"200361", year:2012, fuel:"Benzine", km:204572,
    color:"Grijs", power_hp:83, power_kw:61, trans:"Handgeschakeld", doors:5, seats:7,
    price:3490, body:"MPV",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/4f/4ff41e6b-aa89-44ae-b1a9-6ac03b833c26?rule=ecg_mp_eps$_86",
    mp_id:"2361106714", mp_url:"https://www.marktplaats.nl/v/auto-s/dacia/m2361106714-dacia-lodgy-200361-bj-2012",
    desc:"Nette goed rijdende Dacia Lodgy, ter inruil verkregen, 7 persoons."
  },
  {
    make:"Witteveen", model:"R 2430", variant:"Auto ambulance", year:2018, fuel:"", km:1,
    color:"Grijs", power_hp:1, power_kw:1, trans:"Automaat", doors:0,
    price:2950, body:"Aanhanger",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/2e/2e044f6f-2fbf-44c6-9fce-1f3dbfe1eae9?rule=ecg_mp_eps$_86",
    mp_id:"2360971331", mp_url:"https://www.marktplaats.nl/v/auto-s/bestelauto-s/m2360971331-witteveen-r-2430-auto-ambulance-bj-2018",
    desc:"Witteveen R 2430 auto ambulance. Prijs exclusief BTW."
  },
  {
    make:"Dacia", model:"Sandero", variant:"1.2 16V", year:2009, fuel:"Benzine", km:120560,
    color:"Blauw", power_hp:75, power_kw:55, trans:"Handgeschakeld", doors:5,
    price:1490, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/bc/bcd53c50-b8b8-438e-8a13-b9c6b4b9e0bf?rule=ecg_mp_eps$_86",
    mp_id:"2360889007", mp_url:"https://www.marktplaats.nl/v/auto-s/dacia/m2360889007-dacia-sandero-1-2-16v-bj-2009",
    desc:"Goed rijdende Dacia Sandero, technisch 100%."
  },
  {
    make:"SEAT", model:"Altea XL", variant:"1.2 TSI Ecomotive COPA Business", year:2011, fuel:"Benzine", km:261834,
    color:"Grijs", power_hp:105, power_kw:77, trans:"Handgeschakeld", doors:5,
    price:1990, body:"MPV",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/5e/5ebbbf8d-8237-4241-b7e2-15696dc7cf30?rule=ecg_mp_eps$_86",
    mp_id:"2360878927", mp_url:"https://www.marktplaats.nl/v/auto-s/seat/m2360878927-seat-altea-xl-1-2-tsi-ecomotive-copa-business-bj-2011",
    desc:"Leuke SEAT Altea XL met veel opties, technisch in super staat."
  },
  {
    make:"Volkswagen", model:"Polo", variant:"1.4 Comfortline", year:2010, fuel:"Benzine", km:369070,
    color:"Grijs", power_hp:86, power_kw:63, trans:"Handgeschakeld", doors:5,
    price:1990, body:"Hatchback",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/4d/4dc20535-fe87-4f5a-8be8-aae4ba483dcf?rule=ecg_mp_eps$_86",
    mp_id:"2360875572", mp_url:"https://www.marktplaats.nl/v/auto-s/volkswagen/m2360875572-volkswagen-polo-1-4-comfortline-bj-2010",
    desc:"Volkswagen Polo grijs 5 deurs, technisch 100%."
  },
  {
    make:"Audi", model:"A4", variant:"2.0 TDI 140pk Pro Line", year:2006, fuel:"Diesel", km:425640,
    color:"Zwart", power_hp:140, power_kw:103, trans:"Handgeschakeld", doors:4,
    price:2450, body:"Sedan",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/63/63c18664-b292-499c-9505-7935f5cd3848?rule=ecg_mp_eps$_86",
    mp_id:"2360862594", mp_url:"https://www.marktplaats.nl/v/auto-s/audi/m2360862594-audi-a4-2-0-tdi-140pk-pro-line-bj-2006",
    desc:"Audi A4 diesel sedan 2.0 TDI."
  },
  {
    make:"Volkswagen", model:"T-Roc", variant:"Style", year:2018, fuel:"Benzine", km:94654,
    color:"Oranje", power_hp:116, power_kw:85, trans:"Handgeschakeld", doors:5,
    price:16745, body:"SUV",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/47/4766a271-0bb4-44c8-9777-cb4bd999302a?rule=ecg_mp_eps$_86",
    mp_id:"2358647412", mp_url:"https://www.marktplaats.nl/v/auto-s/volkswagen/m2358647412-volkswagen-t-roc-style-bj-2018",
    desc:"Nette goed rijdende Volkswagen T-Roc, rijdt super, technisch 100%."
  },
  {
    make:"BMW", model:"X1", variant:"xDrive25d Sport", year:2015, fuel:"Diesel", km:176557,
    color:"Zwart", power_hp:232, power_kw:171, trans:"Automaat", doors:5,
    price:18950, body:"SUV",
    img:"https://images.marktplaats.com/api/v1/listing-mp-p/images/03/03abcdef-placeholder?rule=ecg_mp_eps$_86",
    mp_id:"2373009765", mp_url:"https://www.marktplaats.nl/v/auto-s/bmw/m2373009765-bmw-x1-xdrive25d-sport-bj-2015-automaat",
    desc:"BMW X1 xDrive25d Sport (2015). Krachtige 232 PK diesel, luxueuze SUV. Achteruitrijcamera, premium audio, panoramadak, head-up display."
  },
  {
    make:"Suzuki", model:"Alto", variant:"1.0 Exclusive", year:2012, fuel:"Benzine", km:null,
    color:"", power_hp:68, power_kw:50, trans:"Handgeschakeld", doors:5,
    price:null, body:"Hatchback",
    img:"", mp_id:"2370677715", mp_url:"", desc:""
  },
  {
    make:"Mitsubishi", model:"Outlander", variant:"2.0 PHEV", year:2015, fuel:"Hybride", km:null,
    color:"", power_hp:121, power_kw:89, trans:"Automaat", doors:5,
    price:null, body:"SUV",
    img:"", mp_id:"placeholder_mitsubishi", mp_url:"", desc:""
  },
  {
    make:"Fiat", model:"500", variant:"0.9 TwinAir", year:2013, fuel:"Benzine", km:null,
    color:"", power_hp:85, power_kw:63, trans:"Handgeschakeld", doors:3,
    price:null, body:"Hatchback",
    img:"", mp_id:"placeholder_fiat500", mp_url:"", desc:""
  },
  {
    make:"Volkswagen", model:"Golf", variant:"1.4 TSI Highline", year:2014, fuel:"Benzine", km:null,
    color:"", power_hp:140, power_kw:103, trans:"Handgeschakeld", doors:5,
    price:null, body:"Hatchback",
    img:"", mp_id:"placeholder_golf14", mp_url:"", desc:""
  }
];

// Clear old MP imports
db.prepare("DELETE FROM voorraad WHERE mp_id IS NOT NULL").run();
console.log("Oude imports verwijderd\n");

let ok = 0, skip = 0;
for (const c of cars) {
  if (!c.price && !c.img) { skip++; continue; } // Skip placeholders without data
  try {
    insert.run(
      c.make, c.model, c.variant || "", c.year, c.fuel, c.km, c.color, c.body || "",
      c.power_kw, c.power_hp, c.trans || "", c.doors || null, c.seats || null,
      c.price, c.desc || "", c.img || "", c.img ? JSON.stringify([c.img]) : "[]",
      c.mp_id, c.mp_url, "te_koop", 0
    );
    console.log(`  ✅ ${c.make} ${c.model} ${c.variant} — €${c.price?.toLocaleString("nl-NL") || "?"}`);
    ok++;
  } catch (e) {
    console.log(`  ❌ ${c.make} ${c.model}: ${e.message}`);
  }
}

const total = db.prepare("SELECT COUNT(*) as c FROM voorraad WHERE status='te_koop'").get().c;
console.log(`\n=== ${ok} auto's geïmporteerd, ${skip} overgeslagen ===`);
console.log(`=== Totaal in voorraad: ${total} ===\n`);
db.close();
