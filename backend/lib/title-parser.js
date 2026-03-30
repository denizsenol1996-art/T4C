function parseTitle(title, make, model) {
  const t = (title || '').toLowerCase();
  let fuel = '', trans = '', engineCode = '', bodyType = '';

  // BRANDSTOF
  if (/\btdi\b|diesel|\bcdti\b|\bcdi\b|\bbluehdi\b|\bd-4d\b|\bcrdi\b|\bdci\b|\bhdi\b|\bjtd\b|\bjtdm\b|\bbluetech\b|\bsdrive\d+d\b|\bxdrive\d+d\b/.test(t)) fuel = 'diesel';
  else if (/\btsi\b|\btfsi\b|benzine|petrol|\bmpi\b|\bvvt-i\b|\bvtec\b|\bgdi\b|\bskyactiv-g\b|\becoboost\b|\btce\b|\bpuretech\b|\bfsi\b|\bcgi\b|\bvti\b|\btgdi\b|\bt-gdi\b/.test(t)) fuel = 'benzine';
  else if (/elektr|electric|\bev\b|\be-tron\b|\bbev\b|\bid\.\d\b|\bion\b|\bzero.?emiss|\bfull.?electric|\bmodel [3sxy]\b/.test(t)) fuel = 'elektrisch';
  else if (/hybr|\bgte\b|\bphev\b|plug.?in|\be-power\b|\bi-mmd\b/.test(t)) fuel = 'hybride';
  else if (/\blpg\b|\bbifuel\b/.test(t)) fuel = 'lpg';
  else if (/\bcng\b|\baardgas\b/.test(t)) fuel = 'cng';

  if (!fuel) {
    const elModels = /\bid\.3\b|\bid\.4\b|\bid\.5\b|\bid\.buzz\b|\be-golf\b|\be-up\b|\be-tron\b|\beqa\b|\beqb\b|\beqc\b|\beqe\b|\beqs\b|\bi3\b|\bi4\b|\bi5\b|\bi7\b|\bix\b|\bix1\b|\bix3\b|\be-208\b|\be-2008\b|\bspring\b|\bmodel 3\b|\bmodel s\b|\bmodel x\b|\bmodel y\b|\bleaf\b|\bborn\b|\benzaq\b|\bariya\b|\bbz4x\b|\bioniq 5\b|\bioniq 6\b|\bev6\b|\bev9\b|\be-niro\b|\be-soul\b|\bzoe\b|\bampera-e\b/;
    if (elModels.test(t) || elModels.test(model)) fuel = 'elektrisch';
  }

  // TRANSMISSIE
  if (/automaat|automatic|\bdsg\b|\btiptronic\b|\bcvt\b|\bs.tronic\b|\bsteptronic\b|\bpdk\b|\bedc\b|\beat\b|\baisin\b|\bdct\b|\b7g-tronic\b|\b9g-tronic\b|\bpowershift\b|\beasytronic\b/.test(t)) trans = 'automaat';
  else if (/handgeschakeld|manual|handschalt|\b5-bak\b|\b6-bak\b|\b5.speed\b|\b6.speed\b/.test(t)) trans = 'handgeschakeld';

  // MOTORCODE
  const engineMatch = t.match(/(\d\.\d)\s*(tsi|tfsi|tdi|tce|cdi|cdti|dci|hdi|skyactiv-[gd]|ecoboost|puretech|bluehdi|gdi|t-gdi|mpi|vtec|vvt-i|turbo|hybrid|gte|gti|gtd|rs|amg)/i);
  if (engineMatch) engineCode = engineMatch[1] + ' ' + engineMatch[2].toUpperCase();
  if (!engineCode) {
    const sizeMatch = t.match(/\b(\d\.\d)\s*(?:l(?:iter)?|cc)?\s*(?:16v|8v|turbo|t)?\b/);
    if (sizeMatch && parseFloat(sizeMatch[1]) >= 0.6 && parseFloat(sizeMatch[1]) <= 6.5) engineCode = sizeMatch[1];
  }

  // CARROSSERIE
  if (/\btouring\b|\bvariant\b|\bsportstourer\b|\bsw\b|\bcombi\b|\bestate\b|\bbreak\b|\bavant\b|\bsportswagon\b/.test(t)) bodyType = 'stationwagon';
  else if (/\bsuv\b|\bcrossover\b|\bsport activity\b/.test(t)) bodyType = 'suv';
  else if (/\bcabrio\b|\bconvertible\b|\bspider\b|\bspyder\b|\broadster\b/.test(t)) bodyType = 'cabrio';
  else if (/\bcoupé\b|\bcoupe\b/.test(t)) bodyType = 'coupe';
  else if (/\blimousine\b|\bsedan\b|\bberlina\b|\bsaloon\b/.test(t)) bodyType = 'sedan';
  else if (/\bhatchback\b|\b[35]\s*deurs\b|\b[35]-?drs\b/.test(t)) bodyType = 'hatchback';
  else if (/\bmpv\b|\bvan\b|\bbus\b|\bkombi\b/.test(t)) bodyType = 'mpv';

  return { fuel, trans, engineCode, bodyType };
}

module.exports = { parseTitle };
