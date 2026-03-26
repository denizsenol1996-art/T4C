const BRAND_ALIASES = {
  'mercedes':'mercedes-benz','mercedes benz':'mercedes-benz','merc':'mercedes-benz',
  'vw':'volkswagen','citroen':'citroën','citroën':'citroen',
  'skoda':'škoda','škoda':'skoda','mini cooper':'mini',
}
const MODEL_MAP = {
  'mercedes-benz': { 'e 200':'e-klasse','e 220':'e-klasse','e 250':'e-klasse','e 300':'e-klasse','e 350':'e-klasse','e 400':'e-klasse','e 450':'e-klasse','e 500':'e-klasse','e 53':'e-klasse','e 63':'e-klasse','e-klasse':'e-klasse','e klasse':'e-klasse','c 180':'c-klasse','c 200':'c-klasse','c 220':'c-klasse','c 250':'c-klasse','c 300':'c-klasse','c 350':'c-klasse','c 43':'c-klasse','c 63':'c-klasse','c-klasse':'c-klasse','c klasse':'c-klasse','a 140':'a-klasse','a 150':'a-klasse','a 160':'a-klasse','a 170':'a-klasse','a 180':'a-klasse','a 200':'a-klasse','a 220':'a-klasse','a 250':'a-klasse','a 35':'a-klasse','a 45':'a-klasse','a-klasse':'a-klasse','a klasse':'a-klasse','b 150':'b-klasse','b 160':'b-klasse','b 170':'b-klasse','b 180':'b-klasse','b 200':'b-klasse','b 220':'b-klasse','b 250':'b-klasse','b-klasse':'b-klasse','b klasse':'b-klasse','gla':'gla','glb':'glb','glc':'glc','gle':'gle','gls':'gls','cla':'cla','cls':'cls','s 320':'s-klasse','s 350':'s-klasse','s 400':'s-klasse','s 450':'s-klasse','s 500':'s-klasse','s-klasse':'s-klasse','s klasse':'s-klasse','v 220':'v-klasse','v 250':'v-klasse','v 300':'v-klasse','v-klasse':'v-klasse','vito':'vito','sprinter':'sprinter','eqa':'eqa','eqb':'eqb','eqc':'eqc','eqe':'eqe','eqs':'eqs' },
  'bmw': { '114':'1 serie','116':'1 serie','118':'1 serie','120':'1 serie','125':'1 serie','128':'1 serie','m135':'1 serie','m140':'1 serie','1 serie':'1 serie','1-serie':'1 serie','218':'2 serie','220':'2 serie','225':'2 serie','2 serie':'2 serie','2-serie':'2 serie','316':'3 serie','318':'3 serie','320':'3 serie','325':'3 serie','328':'3 serie','330':'3 serie','335':'3 serie','340':'3 serie','m340':'3 serie','m3':'3 serie','3 serie':'3 serie','3-serie':'3 serie','418':'4 serie','420':'4 serie','428':'4 serie','430':'4 serie','435':'4 serie','440':'4 serie','m4':'4 serie','4 serie':'4 serie','4-serie':'4 serie','518':'5 serie','520':'5 serie','525':'5 serie','528':'5 serie','530':'5 serie','535':'5 serie','540':'5 serie','550':'5 serie','m5':'5 serie','5 serie':'5 serie','5-serie':'5 serie','x1':'x1','x2':'x2','x3':'x3','x4':'x4','x5':'x5','x6':'x6','i3':'i3','i4':'i4','ix':'ix','z3':'z3','z4':'z4' },
  'audi': { 'a1':'a1','a3':'a3','a4':'a4','a5':'a5','a6':'a6','a7':'a7','a8':'a8','q2':'q2','q3':'q3','q4':'q4','q5':'q5','q7':'q7','q8':'q8','tt':'tt','rs3':'rs3','rs4':'rs4','rs5':'rs5','rs6':'rs6','s3':'s3','s4':'s4','s5':'s5','e-tron':'e-tron','etron':'e-tron' },
  'volkswagen': { 'golf':'golf','polo':'polo','up':'up','up!':'up','tiguan':'tiguan','touran':'touran','passat':'passat','t-cross':'t-cross','t-roc':'t-roc','taigo':'taigo','arteon':'arteon','touareg':'touareg','caddy':'caddy','transporter':'transporter','crafter':'crafter','id.3':'id.3','id.4':'id.4','id.5':'id.5','id 3':'id.3','id 4':'id.4','id 5':'id.5' },
  'toyota': { 'aygo':'aygo','aygo x':'aygo x','yaris':'yaris','yaris cross':'yaris cross','corolla':'corolla','camry':'camry','c-hr':'c-hr','chr':'c-hr','rav4':'rav4','rav 4':'rav4','land cruiser':'land cruiser','hilux':'hilux','proace':'proace','supra':'supra','bz4x':'bz4x','prius':'prius' },
  'ford': { 'fiesta':'fiesta','focus':'focus','mondeo':'mondeo','puma':'puma','kuga':'kuga','ecosport':'ecosport','transit':'transit','transit custom':'transit custom','mustang':'mustang','mustang mach-e':'mustang mach-e','ranger':'ranger','explorer':'explorer' },
  'peugeot': { '108':'108','208':'208','308':'308','508':'508','2008':'2008','3008':'3008','5008':'5008','e-208':'e-208','e-2008':'e-2008','partner':'partner','expert':'expert','boxer':'boxer','rifter':'rifter' },
  'renault': { 'clio':'clio','megane':'megane','captur':'captur','kadjar':'kadjar','scenic':'scenic','twingo':'twingo','zoe':'zoe','kangoo':'kangoo','trafic':'trafic','master':'master','arkana':'arkana','austral':'austral' },
  'opel': { 'corsa':'corsa','astra':'astra','mokka':'mokka','crossland':'crossland','grandland':'grandland','insignia':'insignia','combo':'combo','vivaro':'vivaro' },
  'citroen': { 'c1':'c1','c3':'c3','c3 aircross':'c3 aircross','c4':'c4','c5':'c5','c5 aircross':'c5 aircross','berlingo':'berlingo','jumpy':'jumpy','jumper':'jumper' },
  'hyundai': { 'i10':'i10','i20':'i20','i30':'i30','i40':'i40','kona':'kona','tucson':'tucson','santa fe':'santa fe','ioniq':'ioniq','ioniq 5':'ioniq 5','ioniq 6':'ioniq 6','bayon':'bayon' },
  'kia': { 'picanto':'picanto','rio':'rio','ceed':'ceed','sportage':'sportage','niro':'niro','sorento':'sorento','stonic':'stonic','xceed':'xceed','ev6':'ev6','ev9':'ev9','soul':'soul' },
  'seat': { 'ibiza':'ibiza','leon':'leon','arona':'arona','ateca':'ateca','tarraco':'tarraco','mii':'mii' },
  'skoda': { 'fabia':'fabia','octavia':'octavia','superb':'superb','karoq':'karoq','kodiaq':'kodiaq','kamiq':'kamiq','scala':'scala','citigo':'citigo','enyaq':'enyaq' },
  'volvo': { 'v40':'v40','v60':'v60','v90':'v90','s40':'s40','s60':'s60','s90':'s90','xc40':'xc40','xc60':'xc60','xc90':'xc90','c40':'c40','ex30':'ex30' },
  'fiat': { '500':'500','500c':'500c','500e':'500e','500x':'500x','500l':'500l','panda':'panda','tipo':'tipo','punto':'punto','ducato':'ducato','doblo':'doblo' },
  'suzuki': { 'swift':'swift','vitara':'vitara','jimny':'jimny','s-cross':'s-cross','ignis':'ignis','baleno':'baleno' },
  'dacia': { 'sandero':'sandero','duster':'duster','logan':'logan','spring':'spring','jogger':'jogger' },
  'tesla': { 'model 3':'model 3','model y':'model y','model s':'model s','model x':'model x' },
  'mini': { 'cooper':'cooper','countryman':'countryman','clubman':'clubman','one':'one' },
  'mazda': { '2':'2','3':'3','6':'6','cx-3':'cx-3','cx-30':'cx-30','cx-5':'cx-5','cx-60':'cx-60','mx-5':'mx-5','mx-30':'mx-30' },
  'nissan': { 'micra':'micra','juke':'juke','qashqai':'qashqai','x-trail':'x-trail','leaf':'leaf','note':'note','navara':'navara','ariya':'ariya' },
  'honda': { 'civic':'civic','jazz':'jazz','cr-v':'cr-v','hr-v':'hr-v','e':'e','zr-v':'zr-v' },
  'porsche': { 'cayenne':'cayenne','macan':'macan','taycan':'taycan','911':'911','boxster':'boxster','cayman':'cayman','panamera':'panamera' },
  'mg': { 'zs':'zs','zs ev':'zs ev','mg4':'mg4','marvel r':'marvel r','hs':'hs','5':'5' },
  'byd': { 'atto 3':'atto 3','dolphin':'dolphin','seal':'seal','tang':'tang','han':'han' },
}
function normalizeMake(make) {
  if (!make) return make
  const lower = make.toLowerCase().trim()
  return BRAND_ALIASES[lower] || lower
}
function normalizeModel(make, model) {
  if (!make || !model) return { crawlerModel: null, confidence: 'none' }
  const makeLower = normalizeMake(make)
  const modelLower = model.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[()]/g, '')
  const tokens = modelLower.split(' ')
  const deduped = tokens.filter((t, i) => tokens.indexOf(t) === i).join(' ')
  const makeKey = MODEL_MAP[makeLower] ? makeLower : Object.keys(MODEL_MAP).find(k => makeLower.includes(k) || k.includes(makeLower))
  if (!makeKey) return { crawlerModel: deduped, confidence: 'passthrough', make: makeLower }
  const mm = MODEL_MAP[makeKey]
  if (mm[deduped]) return { crawlerModel: mm[deduped], confidence: 'exact', make: makeLower }
  const keys = Object.keys(mm).sort((a, b) => b.length - a.length)
  for (const k of keys) { if (deduped.startsWith(k)) return { crawlerModel: mm[k], confidence: 'prefix', make: makeLower } }
  for (const k of keys) { if (deduped.includes(k) && k.length >= 2) return { crawlerModel: mm[k], confidence: 'contains', make: makeLower } }
  const num = deduped.match(/^(\d)/); if (num && mm[num[1]]) return { crawlerModel: mm[num[1]], confidence: 'number', make: makeLower }
  const fw = deduped.split(/[\s-]/)[0]; if (fw.length >= 2 && mm[fw]) return { crawlerModel: mm[fw], confidence: 'first_word', make: makeLower }
  return { crawlerModel: deduped, confidence: 'passthrough', make: makeLower }
}
module.exports = { normalizeModel, normalizeMake, MODEL_MAP, BRAND_ALIASES }
