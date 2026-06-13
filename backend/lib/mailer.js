const nodemailer = require("nodemailer")

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mail.zxcs.nl",
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER || "info@transfer4cars.com",
    pass: process.env.SMTP_PASS || ""
  }
})

// SMTP cooldown: na 3 fails -> 15 min pauze (voorkomt log-spam bij server-issues)
let _smtpFails = 0
let _smtpCooldownUntil = 0

async function sendMail({ to, subject, html, text }) {
  if (!process.env.SMTP_PASS) { console.log("[MAIL] SMTP_PASS niet geconfigureerd, mail overgeslagen"); return false }
  if (_smtpFails >= 3 && Date.now() < _smtpCooldownUntil) { return false }
  if (_smtpFails >= 3 && Date.now() >= _smtpCooldownUntil) { _smtpFails = 0 }
  try {
    await transporter.sendMail({
      from: '"Transfer4Cars" <info@transfer4cars.com>',
      to, subject,
      html: html || undefined,
      text: text || undefined
    })
    _smtpFails = 0
    console.log("[MAIL] Verstuurd naar", to, ":", subject)
    return true
  } catch(e) {
    _smtpFails++
    if (_smtpFails >= 3) {
      _smtpCooldownUntil = Date.now() + 15 * 60 * 1000
      console.log("[MAIL] SMTP faalt " + _smtpFails + "x, cooldown 15 min")
    } else {
      console.log("[MAIL] Fout:", e.message)
    }
    return false
  }
}

// ── HTML email-wrapper met T4C-styling, branded header + footer ──
function htmlWrap({ title, intro, paragraphs = [], ctaText, ctaUrl, footerNote }) {
  const para = paragraphs.map(p => `<p style="margin:0 0 16px;color:#3a3a3a;font-size:15px;line-height:1.55">${p}</p>`).join("")
  const cta = ctaText && ctaUrl ? `
    <table cellpadding="0" cellspacing="0" border="0" style="margin:20px auto"><tr><td>
      <a href="${ctaUrl}" style="display:inline-block;padding:12px 26px;background:#22c55e;color:#000;font-weight:700;text-decoration:none;border-radius:6px;font-size:15px">${ctaText}</a>
    </td></tr></table>` : ""
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f4f8;padding:24px 0">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
        <tr><td style="background:#060a0f;padding:20px 28px;text-align:left">
          <a href="https://transfer4cars.com" style="color:#ffffff;font-size:20px;font-weight:800;text-decoration:none;letter-spacing:-0.5px">Transfer<span style="color:#4ade80">4Cars</span></a>
        </td></tr>
        <tr><td style="padding:32px 32px 8px">
          <h1 style="margin:0 0 8px;font-size:22px;color:#060a0f;font-weight:700">${title}</h1>
          ${intro ? `<p style="margin:0 0 20px;color:#5a6e84;font-size:14px">${intro}</p>` : ""}
        </td></tr>
        <tr><td style="padding:0 32px 24px">
          ${para}
          ${cta}
        </td></tr>
        <tr><td style="background:#f8f9fb;padding:20px 32px;border-top:1px solid #e5e7eb">
          ${footerNote ? `<p style="margin:0 0 8px;color:#5a6e84;font-size:12px;line-height:1.5">${footerNote}</p>` : ""}
          <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.5">
            Transfer4Cars (JHVT Holding B.V.) &middot; KvK 88503925 &middot; BTW NL864657079B01<br>
            Prins Hendrikstraat 58a, 2405 AK Alphen aan den Rijn<br>
            <a href="mailto:info@transfer4cars.com" style="color:#5a6e84">info@transfer4cars.com</a> &middot;
            <a href="tel:+31687997168" style="color:#5a6e84">+31 6 87 99 71 68</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

const BASE = process.env.PUBLIC_URL || "https://transfer4cars.com"
function escapeHtml(s) { return String(s||"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])) }
function nl2br(s) { return escapeHtml(s).replace(/\n/g, "<br>") }

function buildEmail(row) {
  const text = row.body || ""
  switch (row.type) {
    case "welkom":
      return { subject: row.subject, text, html: htmlWrap({
        title: "Welkom bij Transfer4Cars",
        intro: "Je B2B-account is aangemaakt.",
        paragraphs: [
          "Bedankt voor je registratie. Vanaf nu kun je inloggen, voertuigen bekijken en meebieden op live veilingen.",
          "Tip: stel je profielinformatie compleet in zodat winnende biedingen direct verwerkt kunnen worden."
        ],
        ctaText: "Bekijk live veilingen",
        ctaUrl: BASE + "/veilingen/",
        footerNote: "Heb je vragen? Stuur een mail of bel ons gerust."
      })}
    case "veiling_gewonnen":
      return { subject: row.subject, text, html: htmlWrap({
        title: "Gefeliciteerd — winnend bod",
        intro: "Je hebt een veiling gewonnen.",
        paragraphs: [
          nl2br(text),
          "Log in om transport te kiezen, te betalen en de levering te plannen."
        ],
        ctaText: "Naar mijn account",
        ctaUrl: BASE + "/account/",
        footerNote: "Bij vragen over transport, factuur of levering: reply op deze mail."
      })}
    case "veiling_herstart":
      return { subject: row.subject, text, html: htmlWrap({
        title: "Veiling herstart",
        intro: "Een veiling op je watchlist is opnieuw gestart.",
        paragraphs: [nl2br(text), "Het minimumbedrag was niet bereikt — nieuwe ronde is begonnen."],
        ctaText: "Bekijk de veiling",
        ctaUrl: BASE + "/veilingen/"
      })}
    case "nieuwe_veiling":
      return { subject: row.subject, text, html: htmlWrap({
        title: "Nieuwe veiling beschikbaar",
        intro: "Er is zojuist een veiling toegevoegd.",
        paragraphs: [nl2br(text)],
        ctaText: "Bekijk live veilingen",
        ctaUrl: BASE + "/veilingen/"
      })}
    case "admin_alert":
      return { subject: row.subject, text, html: htmlWrap({
        title: "Nieuwe B2B aanmelding",
        intro: "Een dealer heeft zich aangemeld via de site.",
        paragraphs: [nl2br(text)],
        ctaText: "Admin dashboard",
        ctaUrl: BASE + "/admin/"
      })}
    case "aanmelding_ontvangen":
      return { subject: row.subject, text, html: htmlWrap({
        title: "Bedankt voor je aanmelding",
        intro: "We hebben je B2B-aanvraag in goede orde ontvangen.",
        paragraphs: [
          nl2br(text),
          "Een van onze medewerkers beoordeelt je aanvraag binnen 24 uur. Zodra je account is goedgekeurd ontvang je een bevestiging met inloggegevens.",
          "Vragen in de tussentijd? Reply gerust op deze mail of bel ons op 06 87 99 71 68."
        ],
        ctaText: "Bekijk Transfer4Cars",
        ctaUrl: BASE + "/",
        footerNote: "Deze mail is automatisch verstuurd na je aanmelding op transfer4cars.com."
      })}
    default:
      return { subject: row.subject, text, html: htmlWrap({
        title: row.subject || "Transfer4Cars",
        paragraphs: [nl2br(text)]
      })}
  }
}

// ── Queue processor — wordt elke minuut aangeroepen vanuit server.js ──
async function processEmailQueue() {
  let stmts
  try { stmts = require("../db").stmts } catch { return }
  if (!stmts || !stmts.getPendingEmails) return
  const pending = stmts.getPendingEmails.all() || []
  for (const row of pending) {
    const { subject, html, text } = buildEmail(row)
    const ok = await sendMail({ to: row.to_email, subject, html, text })
    if (ok) { try { stmts.markEmailSent.run(row.id) } catch(e) { console.log("[MAIL] markSent error:", e.message) } }
  }
}

module.exports = { sendMail, transporter, processEmailQueue, buildEmail, htmlWrap }
