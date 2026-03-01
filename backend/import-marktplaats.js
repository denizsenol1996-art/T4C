// T4C Marktplaats Import — via Server API
// Run while server is running: node import-marktplaats.js
const http = require('http');
const SERVER = 'http://localhost:3000';

const cars = [
  { make:'Peugeot', model:'107', model_variant:'XS 1.0', year:2012, km:200050, vraag_prijs:1750, fuel:'Benzine', color:'Grijs', power_kw:50, power_hp:68, body:'Hatchback', transmission:'Handgeschakeld', doors:3, seats:4, beschrijving:'Nette goed rijdende Peugeot 107 technisch 100%. Airco, elektrische ramen, stuurbekrachtiging. Zeer zuinig en betrouwbaar stadsautootje.', highlights:'Airco,Elektrische ramen,Stuurbekrachtiging,APK nieuw' },
  { make:'Suzuki', model:'Swift', model_variant:'1.3 Shogun', year:2007, km:262630, vraag_prijs:1300, fuel:'Benzine', color:'Blauw', power_kw:68, power_hp:92, body:'Hatchback', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Airco | Lichtmetalen velgen | Betrouwbare en complete auto. Rijdt uitstekend, motor en versnellingsbak in topconditie.', highlights:'Airco,LM velgen,Centrale vergrendeling,Elektrische ramen' },
  { make:'Nissan', model:'Leaf', model_variant:'30kWh Tekna', year:2016, km:125377, vraag_prijs:4950, fuel:'Elektrisch', color:'Blauw', power_kw:80, power_hp:109, body:'Hatchback', transmission:'Automaat', doors:5, seats:5, beschrijving:'360 camera | Leder | Stoel- & stuurverwarming | Vol opties. Zeer nette Nissan Leaf met grote 30kWh accu, bereik circa 180km.', highlights:'360 Camera,Leder,Stoelverwarming,Stuurverwarming,Navigatie,Keyless entry' },
  { make:'Renault', model:'Megane', model_variant:'dCi 110 ECO2 Expression', year:2012, km:212462, vraag_prijs:2300, fuel:'Diesel', color:'Grijs', power_kw:81, power_hp:110, body:'Sedan', transmission:'Handgeschakeld', doors:4, seats:5, beschrijving:'Zuinige diesel sedan. Comfortabel en ruim interieur met airco, cruise control en navigatie.', highlights:'Airco,Cruise control,Navigatie,Parkeersensoren' },
  { make:'Audi', model:'A4', model_variant:'1.8 TFSI Pro Line S (S-Line)', year:2011, km:258824, vraag_prijs:5990, fuel:'Benzine', color:'Grijs', power_kw:88, power_hp:120, body:'Sedan', transmission:'Handgeschakeld', doors:4, seats:5, beschrijving:'Zeer complete en sportieve Audi A4 met dubbel S-Line uitvoering. Xenon, LED, leder, navi, 18 inch wielen.', highlights:'S-Line,Xenon,LED,Leder,Navigatie,18" LM velgen,Sportstoelen' },
  { make:'Peugeot', model:'207', model_variant:'Feline 1.6 Turbo', year:2008, km:132030, vraag_prijs:3450, fuel:'Benzine', color:'Zwart', power_kw:110, power_hp:150, body:'Hatchback', transmission:'Handgeschakeld', doors:3, seats:5, beschrijving:'Comfortabel | Prettig rijgedrag | 150pk Turbo motor. Lekker vlotte auto met panoramadak en leder.', highlights:'Panoramadak,Leder,Turbo,Cruise control,Klimaatregeling' },
  { make:'Lexus', model:'RX 400h', model_variant:'Edition', year:2008, km:194171, vraag_prijs:11950, fuel:'Hybride', color:'Grijs', power_kw:155, power_hp:211, body:'SUV', transmission:'Automaat', doors:5, seats:5, beschrijving:'Nette Lexus RX400h technisch 100% distributieriem vervangen. Luxe SUV met alle opties, extreem betrouwbaar.', highlights:'Leder,Navigatie,Sunroof,Mark Levinson audio,Achteruitrijcamera,Trekhaak', featured:true },
  { make:'BMW', model:'5 Serie', model_variant:'530i Executive', year:2001, km:281057, vraag_prijs:5950, fuel:'Benzine', color:'Grijs', power_kw:170, power_hp:231, body:'Sedan', transmission:'Automaat', doors:4, seats:5, beschrijving:'Nette BMW 530i E39 vol opties liefhebbersauto. 231pk zescilinder, leder, xenon, schuifdak.', highlights:'Leder,Xenon,Schuifdak,231PK,Automaat,Cruise control' },
  { make:'Volkswagen', model:'Golf', model_variant:'1.6 TDI Trendline Variant', year:2013, km:331368, vraag_prijs:3990, fuel:'Diesel', color:'Zwart', power_kw:77, power_hp:105, body:'Stationwagon', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Nette Golf Variant technisch 100% Diesel. Ruime stationwagon, zuinig en betrouwbaar.', highlights:'Airco,Cruise control,Bluetooth,Trekhaak' },
  { make:'Suzuki', model:'Vitara', model_variant:'1.4 B.jet Stijl', year:2018, km:99450, vraag_prijs:17950, fuel:'Benzine', color:'Rood', power_kw:103, power_hp:140, body:'SUV', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Nette auto met leuke opties proefrit mogelijk. Moderne SUV met camera, navigatie en adaptive cruise.', highlights:'Navigatie,Camera,Adaptive cruise,LED,Apple CarPlay,Lane assist', featured:true },
  { make:'Kia', model:'Niro', model_variant:'1.6 GDi Hybrid Design Edition', year:2018, km:191072, vraag_prijs:10950, fuel:'Hybride', color:'Blauw', power_kw:77, power_hp:105, body:'SUV', transmission:'Automaat', doors:5, seats:5, beschrijving:'Adaptive Cruise | Stoel- & stuurverwarming | Lane Assist. Complete hybride SUV, zeer zuinig 1 op 22.', highlights:'Adaptive cruise,Stoelverwarming,Lane assist,Navigatie,Camera,Android Auto', featured:true },
  { make:'Opel', model:'Corsa', model_variant:'OPC', year:2008, km:199504, vraag_prijs:4950, fuel:'Benzine', color:'Blauw', power_kw:141, power_hp:192, body:'Hatchback', transmission:'Handgeschakeld', doors:3, seats:4, beschrijving:'Hot hatch met karakter | Sportieve prestaties | Strakke wegligging. 192pk OPC met Recaro stoelen.', highlights:'Recaro,192PK,Sportsuspensie,Cruise control,Airco' },
  { make:'Ford', model:'Focus', model_variant:'1.6 EcoBoost Titanium', year:2012, km:251836, vraag_prijs:3950, fuel:'Benzine', color:'Bruin', power_kw:110, power_hp:150, body:'Hatchback', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Nette Ford Focus luxe Titanium uitvoering met EcoBoost motor.', highlights:'Navigatie,Parkeersensoren,Cruise control,Klimaatregeling,Bluetooth' },
  { make:'Toyota', model:'RAV4', model_variant:'2.5 Hybrid 4WD Energy Plus', year:2018, km:234786, vraag_prijs:17950, fuel:'Hybride', color:'Grijs', power_kw:114, power_hp:155, body:'SUV', transmission:'Automaat', doors:5, seats:5, beschrijving:'Ruim | Comfort | Zuinig | Betrouwbaar. Toyota RAV4 Hybrid met 4WD, camera, navigatie. Toyota betrouwbaarheid.', highlights:'4WD,Navigatie,Camera,Stoelverwarming,Toyota Safety Sense,Trekhaak', featured:true },
  { make:'Ford', model:'Transit', model_variant:'L3H3 RWD', year:2015, km:184936, vraag_prijs:8950, fuel:'Diesel', color:'Wit', power_kw:114, power_hp:155, body:'Bestelbus', transmission:'Handgeschakeld', doors:3, seats:3, beschrijving:'Nette Ford Transit L3H3 achterwielaandrijving technisch 100%. Unieke bullbar. Prijs ex BTW.', highlights:'L3H3,RWD,Airco,Cruise control,Bullbar,Ex BTW' },
  { make:'Peugeot', model:'RCZ', model_variant:'1.6 THP 155', year:2011, km:107178, vraag_prijs:6495, fuel:'Benzine', color:'Zwart', power_kw:115, power_hp:157, body:'Coupe', transmission:'Handgeschakeld', doors:2, seats:4, beschrijving:'Nette Peugeot RCZ ter inruil verkregen technisch 100%. Prachtige sportcoupe met leder en navigatie.', highlights:'Leder,Navigatie,Xenon,19" velgen,Parkeersensoren', featured:true },
  { make:'Volkswagen', model:'T-Roc', model_variant:'Style', year:2018, km:94654, vraag_prijs:16745, fuel:'Benzine', color:'Oranje', power_kw:85, power_hp:116, body:'SUV', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Nette Volkswagen T-Roc rijdt super technisch 100%. Moderne SUV met LED, camera en adaptive cruise.', highlights:'LED,Camera,Adaptive cruise,Digital cockpit,Apple CarPlay,Lane assist', featured:true },
  { make:'Chevrolet', model:'Spark', model_variant:'1.0 LS', year:2010, km:170228, vraag_prijs:1490, fuel:'Benzine', color:'Blauw', power_kw:50, power_hp:68, body:'Hatchback', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Klein, handig stadsautootje. Zuinig in gebruik en onderhoud.', highlights:'Airco,Elektrische ramen,Centrale vergrendeling' },
  { make:'Skoda', model:'Octavia', model_variant:'1.6 TDI Elegance Business', year:2012, km:238594, vraag_prijs:3990, fuel:'Diesel', color:'Grijs', power_kw:77, power_hp:105, body:'Sedan', transmission:'Handgeschakeld', doors:4, seats:5, beschrijving:'Comfort | Ruimte | Betrouwbaar | Zuinig. Elegance uitvoering met navigatie, leder en PDC.', highlights:'Navigatie,Leder,PDC,Cruise control,Klimaatregeling' },
  { make:'Fiat', model:'Punto', model_variant:'Abarth 1.4 T-Jet', year:2008, km:278424, vraag_prijs:2950, fuel:'Benzine', color:'Wit', power_kw:115, power_hp:157, body:'Hatchback', transmission:'Handgeschakeld', doors:3, seats:5, beschrijving:'Nette Abarth Punto proefrit mogelijk. 157pk turbo met Abarth sportuitlaat en wielophanging.', highlights:'Abarth,Turbo,Sportsuspensie,Sportuitlaat,Recaro' },
  { make:'Dacia', model:'Lodgy', model_variant:'7-persoons', year:2012, km:204572, vraag_prijs:3490, fuel:'Benzine', color:'Grijs', power_kw:61, power_hp:83, body:'MPV', transmission:'Handgeschakeld', doors:5, seats:7, beschrijving:'Nette Dacia Lodgy ter inruil verkregen 7 persoons. Ruime gezinsauto met airco.', highlights:'7-persoons,Airco,Elektrische ramen,Isofix' },
  { make:'Dacia', model:'Sandero', model_variant:'1.2 16V', year:2009, km:120560, vraag_prijs:1490, fuel:'Benzine', color:'Blauw', power_kw:55, power_hp:75, body:'Hatchback', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Goed rijdende Dacia Sandero technisch 100%. Betrouwbaar en voordelig in onderhoud.', highlights:'Stuurbekrachtiging,Centrale vergrendeling' },
  { make:'SEAT', model:'Altea XL', model_variant:'1.2 TSI COPA Business', year:2011, km:261834, vraag_prijs:1990, fuel:'Benzine', color:'Grijs', power_kw:77, power_hp:105, body:'MPV', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Leuke SEAT Altea XL met veel opties technisch super. Ruime MPV met navigatie en cruise control.', highlights:'Navigatie,Cruise control,Airco,LM velgen,Parkeersensoren' },
  { make:'Volkswagen', model:'Polo', model_variant:'1.4 Comfortline', year:2010, km:369070, vraag_prijs:1990, fuel:'Benzine', color:'Grijs', power_kw:63, power_hp:86, body:'Hatchback', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Volkswagen Polo grijs 5 deurs technisch 100%. Betrouwbaar en zuinig.', highlights:'Airco,Cruise control,Elektrische ramen,Centrale vergrendeling' },
  { make:'Audi', model:'A4', model_variant:'2.0 TDI Pro Line', year:2006, km:425640, vraag_prijs:2450, fuel:'Diesel', color:'Zwart', power_kw:103, power_hp:140, body:'Sedan', transmission:'Handgeschakeld', doors:4, seats:5, beschrijving:'Audi A4 Diesel Sedan 2.0 TDI. Nette auto met goede service historie.', highlights:'Airco,Cruise control,Multistuur,Bluetooth' },
  { make:'Renault', model:'Megane Scenic', model_variant:'TCe 130 Dynamique', year:2010, km:200388, vraag_prijs:2500, fuel:'Benzine', color:'Zwart', power_kw:96, power_hp:131, body:'MPV', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Renault Megane Scenic TCe 130 Dynamique. Ruime gezinsauto met panoramadak.', highlights:'Panoramadak,Navigatie,Klimaatregeling,Cruise control,PDC' },
  { make:'Ford', model:'Focus', model_variant:'1.0 EcoBoost ECOnetic', year:2012, km:209544, vraag_prijs:2750, fuel:'Benzine', color:'Grijs', power_kw:74, power_hp:101, body:'Hatchback', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Motor vervangen! Technisch super staat. Zuinige EcoBoost motor.', highlights:'Nieuwe motor,Airco,Bluetooth,Cruise control' },
  { make:'Ford', model:'Focus', model_variant:'1.6 EcoBoost First Edition', year:2012, km:242080, vraag_prijs:3750, fuel:'Benzine', color:'Grijs', power_kw:110, power_hp:150, body:'Hatchback', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Nette Ford Focus ter inruil verkregen technisch 100%. First Edition met vol opties.', highlights:'First Edition,Navigatie,Leder,Xenon,Parkeersensoren' },
  { make:'Witteveen', model:'R 2430', model_variant:'Auto ambulance', year:2018, km:1, vraag_prijs:2950, fuel:'Overig', color:'Grijs', power_kw:0, power_hp:0, body:'Aanhanger', transmission:'Nvt', doors:0, seats:0, beschrijving:'Witteveen R 2430 Auto ambulance. Geschikt voor autotransport. Prijs ex BTW.', highlights:'Autotransport,Kantelbaar,Lier,Ex BTW' },
  { make:'Volkswagen', model:'Golf', model_variant:'1.2 TSI BlueMotion Tour', year:2010, km:310546, vraag_prijs:2990, fuel:'Benzine', color:'Wit', power_kw:76, power_hp:103, body:'Hatchback', transmission:'Handgeschakeld', doors:5, seats:5, beschrijving:'Nette Golf 1.2 technisch 100%. Zuinige TSI motor met navigatie en cruise control.', highlights:'Navigatie,Cruise control,Airco,Bluetooth,LM velgen' },
];

function postJSON(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(SERVER + path);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch(e) { reject(e) } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function importAll() {
  console.log('\nImporting ' + cars.length + ' cars via server API...\n');
  let ok = 0, fail = 0;
  for (const c of cars) {
    try {
      const r = await postJSON('/api/voorraad/add', {
        ...c, kenteken: '', engine_label: c.engine_label || '',
        status: 'te_koop', featured: c.featured || false
      });
      if (r.ok) {
        console.log('  [OK]  ' + c.make + ' ' + c.model + ' ' + c.model_variant + ' - EUR ' + c.vraag_prijs + (r.id ? ' (id:' + r.id + ')' : ''));
        ok++;
      } else {
        console.log('  [!!]  ' + c.make + ' ' + c.model + ' - ' + (r.error || 'error'));
        fail++;
      }
    } catch(e) {
      console.log('  [!!]  ' + c.make + ' ' + c.model + ' - ' + e.message);
      fail++;
    }
  }
  console.log('\nDone! ' + ok + ' imported, ' + fail + ' failed');
  console.log('Open ' + SERVER + '/verkoop/ to see your inventory!\n');
}

importAll().catch(e => {
  console.error('\n[FOUT] Kan niet verbinden met server. Draait de server?');
  console.error(e.message);
});
