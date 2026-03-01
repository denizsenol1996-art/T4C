// ── T4C Photo Branding ──
// Adds Transfer4Cars branding overlay to car photos
const Jimp = require("jimp")
const path = require("path")

/**
 * Add T4C branding to a photo
 * @param {string} inputPath - Path to original photo
 * @param {string} outputPath - Path to save branded photo (can be same as input)
 * @returns {Promise<void>}
 */
async function brandPhoto(inputPath, outputPath) {
  const img = await Jimp.read(inputPath)
  const w = img.getWidth()
  const h = img.getHeight()

  // ── Bar dimensions ──
  const barH = Math.round(h * 0.12)  // 12% of image height
  const barY = h - barH

  // ── Dark gradient overlay at bottom ──
  // Create gradient: transparent at top → 85% opaque at bottom
  for (let y = 0; y < barH; y++) {
    const progress = y / barH
    // Ease in - more transparent at top, solid at bottom
    const alpha = Math.round(progress * progress * 0.88 * 255)
    for (let x = 0; x < w; x++) {
      const current = img.getPixelColor(x, barY + y)
      const rgba = Jimp.intToRGBA(current)
      // Blend towards dark navy (#1a2836)
      const r = Math.round(rgba.r * (1 - alpha/255) + 26 * (alpha/255))
      const g = Math.round(rgba.g * (1 - alpha/255) + 40 * (alpha/255))
      const b = Math.round(rgba.b * (1 - alpha/255) + 54 * (alpha/255))
      img.setPixelColor(Jimp.rgbaToInt(r, g, b, 255), x, barY + y)
    }
  }

  // ── Also add subtle top gradient for logo area ──
  const topBarH = Math.round(h * 0.06)
  for (let y = 0; y < topBarH; y++) {
    const progress = 1 - (y / topBarH)
    const alpha = Math.round(progress * progress * 0.5 * 255)
    for (let x = 0; x < w; x++) {
      const current = img.getPixelColor(x, y)
      const rgba = Jimp.intToRGBA(current)
      const r = Math.round(rgba.r * (1 - alpha/255) + 26 * (alpha/255))
      const g = Math.round(rgba.g * (1 - alpha/255) + 40 * (alpha/255))
      const b = Math.round(rgba.b * (1 - alpha/255) + 54 * (alpha/255))
      img.setPixelColor(Jimp.rgbaToInt(r, g, b, 255), x, y)
    }
  }

  // ── Green accent line above bar ──
  const lineY = barY
  const lineH = Math.max(2, Math.round(h * 0.003))
  for (let y = 0; y < lineH; y++) {
    for (let x = 0; x < w; x++) {
      img.setPixelColor(Jimp.rgbaToInt(94, 189, 62, 255), x, lineY + y)  // #5ebd3e
    }
  }

  // ── Load fonts ──
  // Select font size based on image width
  let mainFont, subFont
  if (w >= 1600) {
    mainFont = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE)
    subFont = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE)
  } else if (w >= 800) {
    mainFont = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE)
    subFont = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE)
  } else {
    mainFont = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE)
    subFont = await Jimp.loadFont(Jimp.FONT_SANS_8_WHITE)
  }

  // ── Print main text: TRANSFER4CARS ──
  const mainText = "TRANSFER4CARS"
  const mainTextW = Jimp.measureText(mainFont, mainText)
  const mainX = Math.round((w - mainTextW) / 2)
  const mainY = barY + Math.round(barH * 0.18)
  img.print(mainFont, mainX, mainY, mainText)

  // ── Print sub text: www.transfer4cars.com ──
  const subText = "www.transfer4cars.com"
  const subTextW = Jimp.measureText(subFont, subText)
  const subX = Math.round((w - subTextW) / 2)
  const subY = barY + Math.round(barH * 0.58)
  img.print(subFont, subX, subY, subText)

  // ── Save ──
  await img.quality(90).writeAsync(outputPath || inputPath)
  console.log(`[BRAND] Branded: ${path.basename(outputPath || inputPath)} (${w}x${h})`)
}

module.exports = { brandPhoto }
