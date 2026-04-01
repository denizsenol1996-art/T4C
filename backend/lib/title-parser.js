function parseTitle(title, make, model) {
  const t = (title || '').toLowerCase();
  let fuel = '', trans = '', engineCode = '', bodyType = '';

  // BRANDSTOF — ook als code vastzit aan cijfers (116CDI, 2.3DCi, 1.6HDi)
  if (/tdi|diesel|cdti|cdi|bluehdi|d-4d|crdi|dci|hdi|jtd|jtdm|bluedc|sdrive\d+d|xdrive\d+d|\d\.\dd\b/i.test(t)) fuel = 'diesel';
  else if (/tsi|tfsi|benzine|petrol|mpi|vvt-i|vtec|gdi|skyactiv-g|ecoboost|tce|puretech|fsi|cgi|vti|tgdi|t-gdi|firefly/i.test(t)) fuel = 'benzine';
  else if (/elektr|electric|\bev\b|e-tron|\bbev\b|id\.\d|\bion\b|zero.?emiss|full.?electric|model [3sxy]/i.test(t)) fuel = 'elektrisch';
  else if (/hybr|\bgte\b|\bphev\b|plug.?in|e-power|i-mmd|e-hev|ehybrid|mild.?hybrid/i.test(t)) fuel = 'hybride';
  else if (/\blpg\b|bifuel/i.test(t)) fuel = 'lpg';
  else if (/\bcng\b|aardgas/i.test(t)) fuel = 'cng';

  if (!fuel) {
    const elModels = /id\.3|id\.4|id\.5|id\.buzz|e-golf|e-up|e-tron|eqa|eqb|eqc|eqe|eqs|\bi3\b|\bi4\b|\bi5\b|\bi7\b|\bix\b|ix1|ix3|e-208|e-2008|spring|model 3|model s|model x|model y|leaf|born|enyaq|ariya|bz4x|ioniq 5|ioniq 6|ev6|ev9|e-niro|e-soul|zoe|ampera-e|mach-e/i;
    if (elModels.test(t) || elModels.test(model || '')) fuel = 'elektrisch';
  }

  // Fuel uit pk/vermogen hint als niks gevonden
  if (!fuel) {
    if (/\b\d+pk\b|\b\d+\s*pk\b|\b\d+\s*kw\b/i.test(t)) {
      // Heeft vermogen maar geen brandstof — waarschijnlijk benzine (meest voorkomend)
      // Niet toekennen, laat leeg
    }
  }

  // TRANSMISSIE — breder zoeken
  if (/automaat|automatic|\bdsg\b|tiptronic|\bcvt\b|s.tronic|steptronic|\bpdk\b|\bedc\b|\bdct\b|7g-tronic|9g-tronic|powershift|easytronic|multitronic|e-cvt|direct.?shift|\bat\b|shifttronic|speedshift|selespeed|sensodrive|quickshift|piloted/i.test(t)) trans = 'automaat';
  else if (/handgeschakeld|manual|handschalt|\b5-bak\b|\b6-bak\b|5.speed|6.speed|5-gang|6-gang|\b5v\b|\b6v\b|\bmt\b/i.test(t)) trans = 'handgeschakeld';

  // MOTORCODE — verbeterd
  const engineMatch = t.match(/(\d\.\d)\s*(tsi|tfsi|tdi|tce|cdi|cdti|dci|hdi|skyactiv-[gd]|ecoboost|puretech|bluehdi|gdi|t-gdi|mpi|vtec|vvt-i|turbo|hybrid|gte|gti|gtd|rs|amg|firefly)/i);
  if (engineMatch) engineCode = engineMatch[1] + ' ' + engineMatch[2].toUpperCase();
  if (!engineCode) {
    // Vang codes als 116CDI, 214CDI, 318d, 320i
    const codeMatch = t.match(/\b(\d{3})\s*(cdi|tdi|dci|cdti|hdi|tsi|tfsi|d|i)\b/i);
    if (codeMatch) engineCode = codeMatch[1] + codeMatch[2].toUpperCase();
  }
  if (!engineCode) {
    const sizeMatch = t.match(/\b(\d\.\d)\s*(?:l(?:iter)?|cc)?\s*(?:16v|8v|turbo|t)?\b/);
    if (sizeMatch && parseFloat(sizeMatch[1]) >= 0.6 && parseFloat(sizeMatch[1]) <= 6.5) engineCode = sizeMatch[1];
  }

  // CARROSSERIE — uitgebreid
  if (/\btouring\b|\bvariant\b|sportstourer|\bsw\b|\bcombi\b|\bestate\b|\bbreak\b|\bavant\b|sportswagon|sportwagen/i.test(t)) bodyType = 'stationwagon';
  else if (/\bsuv\b|crossover|sport activity|allroad|alltrack|cross country/i.test(t)) bodyType = 'suv';
  else if (/cabrio|convertible|spider|spyder|roadster/i.test(t)) bodyType = 'cabrio';
  else if (/coup[eé]|coupe/i.test(t)) bodyType = 'coupe';
  else if (/limousine|\bsedan\b|berlina|saloon/i.test(t)) bodyType = 'sedan';
  else if (/hatchback|[35]\s*deurs|[35]-?drs/i.test(t)) bodyType = 'hatchback';
  else if (/\bmpv\b|\bvan\b|\bbus\b|\bkombi\b/i.test(t)) bodyType = 'mpv';
  else if (/pick.?up|pickup/i.test(t)) bodyType = 'pickup';

  return { fuel, trans, engineCode, bodyType };
}

module.exports = { parseTitle };
