#!/bin/bash
# CarDatax v10.7.0 - OCR setup
# Run: sudo bash setup-ocr.sh

echo "═══ CarDatax OCR Setup ═══"

# System tesseract (C++ - fast)
apt update && apt install -y tesseract-ocr tesseract-ocr-eng

# Node dependencies
cd /root/t4c/backend 2>/dev/null || cd "$(dirname "$0")/backend" 2>/dev/null || cd backend 2>/dev/null
npm install jimp tesseract.js

# Verify
echo ""
echo "═══ Check ═══"
tesseract --version 2>&1 | head -1 && echo "✓ System tesseract OK" || echo "✗ System tesseract NIET gevonden"
node -e "require('jimp');console.log('✓ Jimp OK')" 2>/dev/null || echo "✗ Jimp NIET gevonden"

echo ""
echo "Klaar! Restart je server: pm2 restart all"
