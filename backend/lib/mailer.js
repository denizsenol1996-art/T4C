const nodemailer = require("nodemailer")
const { stmts } = require("../db")

const transporter = nodemailer.createTransport({
  host: "mail.zxcs.nl",
  port: 465,
  secure: true,
  auth: {
    user: "info@transfer4cars.com",
    pass: process.env.SMTP_PASS || "WACHTWOORD_HIER"
  }
})

async function processEmailQueue() {
  if (!process.env.SMTP_PASS && transporter.options.auth.pass === "WACHTWOORD_HIER") return
  try {
    const pending = stmts.getPendingEmails.all()
    for (const email of pending) {
      try {
        await transporter.sendMail({
          from: '"Transfer4Cars" <info@transfer4cars.com>',
          to: email.to_email,
          subject: email.subject,
          text: email.body
        })
        stmts.markEmailSent.run(email.id)
        console.log(`[MAIL] Sent: ${email.subject} -> ${email.to_email}`)
      } catch(e) {
        console.error(`[MAIL] Failed: ${email.to_email} - ${e.message}`)
      }
    }
  } catch(e) { console.error("[MAIL] Queue error:", e.message) }
}

// Process queue every 2 minutes
setInterval(processEmailQueue, 2 * 60 * 1000)

module.exports = { processEmailQueue, transporter }
