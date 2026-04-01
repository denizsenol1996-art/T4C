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

async function sendMail({ to, subject, html, text }) {
  if (!process.env.SMTP_PASS) { console.log("[MAIL] SMTP_PASS niet geconfigureerd, mail overgeslagen"); return false }
  try {
    await transporter.sendMail({
      from: '"Transfer4Cars" <info@transfer4cars.com>',
      to,
      subject,
      html: html || undefined,
      text: text || undefined
    })
    console.log("[MAIL] Verstuurd naar", to, ":", subject)
    return true
  } catch(e) {
    console.log("[MAIL] Fout:", e.message)
    return false
  }
}

module.exports = { sendMail, transporter }
