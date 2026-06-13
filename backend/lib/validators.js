// T4C input-validators — 2026-06-11
// Strengere checks dan ad-hoc length/regex in routes. Doel: typo's + fake-KvK's
// + ongeldige BTW-nummers afvangen vóór ze in users/contact_requests landen.
//
// Geen externe API-calls (geen KvK-register-lookup) — alleen format + checksum.

// E-mail: simpele praktische regex (RFC5322 is te complex en niet sneller te
// herkennen — we accepteren mailadres als het "iets@iets.iets" lijkt).
function isValidEmail(s) {
  if (!s || typeof s !== "string") return false
  s = s.trim()
  if (s.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)
}

// KvK-nummer: NL Kamer van Koophandel hanteert 8-cijferig format. Geen officiële
// 11-proef checksum (in tegenstelling tot BSN). We doen wel anti-fake checks:
// - exact 8 cijfers (na het stripen van spaties/streepjes)
// - niet 00000000
// - niet 1 herhaald cijfer (11111111, 88888888, etc.)
// - niet 12345678 / 87654321 (sequenties)
function isValidKvK(s) {
  if (!s) return false
  const digits = String(s).replace(/\D/g, "")
  if (digits.length !== 8) return false
  if (/^(\d)\1{7}$/.test(digits)) return false   // alle gelijk
  if (digits === "12345678" || digits === "87654321") return false
  if (digits === "00000000") return false
  return true
}

// BTW-nummer NL: NL + 9 cijfers + B + 2 cijfers (totaal 14 chars).
// Voorbeeld: NL864657079B01 (JHVT Holding).
// Mag leeg zijn (optioneel veld) — geef true terug als leeg.
function isValidBTW(s) {
  if (!s) return true // optioneel
  const clean = String(s).replace(/\s/g, "").toUpperCase()
  return /^NL\d{9}B\d{2}$/.test(clean)
}

// Postcode NL: 4 cijfers + (optioneel spatie) + 2 letters (geen SA/SD/SS — die zijn gereserveerd).
function isValidPostcode(s) {
  if (!s) return true // optioneel
  const clean = String(s).replace(/\s/g, "").toUpperCase()
  if (!/^[1-9]\d{3}[A-Z]{2}$/.test(clean)) return false
  const letters = clean.slice(4)
  if (["SA","SD","SS"].includes(letters)) return false
  return true
}

// Telefoonnummer: NL of internationaal. Accept 10 cijfers (0X-X), +31 ..., of internationaal +XX...
// Geen exhaustive ITU-T check — pragmatisch.
function isValidPhone(s) {
  if (!s) return false
  const clean = String(s).replace(/[\s\-\.\(\)]/g, "")
  // +XX gevolgd door 7-15 cijfers
  if (/^\+\d{7,15}$/.test(clean)) return true
  // 0X gevolgd door 8-9 cijfers (NL formaat)
  if (/^0\d{8,9}$/.test(clean)) return true
  return false
}

// Bedrijfsnaam: minstens 2 chars, max 200, geen pure HTML-tag-content
function isValidBedrijf(s) {
  if (!s) return false
  s = String(s).trim()
  if (s.length < 2 || s.length > 200) return false
  if (/^<[^>]+>$/.test(s)) return false
  return true
}

// Wachtwoord: minstens 8 chars, niet enkel cijfers, geen common passwords
const COMMON_PASSWORDS = new Set([
  "password","12345678","11111111","00000000","qwerty12","abc12345",
  "wachtwoord","welkom01","password1","letmein01"
])
function isStrongPassword(s) {
  if (!s || typeof s !== "string") return false
  if (s.length < 8) return false
  if (/^\d+$/.test(s)) return false
  if (COMMON_PASSWORDS.has(s.toLowerCase())) return false
  return true
}

module.exports = {
  isValidEmail,
  isValidKvK,
  isValidBTW,
  isValidPostcode,
  isValidPhone,
  isValidBedrijf,
  isStrongPassword,
}
