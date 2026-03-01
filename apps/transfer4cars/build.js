/**
 * Transfer4Cars — Build Script
 * Kopieert de web-bestanden naar www/ voor Capacitor
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'sites', 'transfer4cars');
const DEST = path.join(__dirname, 'www');

// Maak www/ schoon
if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true });
fs.mkdirSync(DEST, { recursive: true });

// Kopieer bestanden recursief
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(SRC, DEST);

// Injecteer API base URL configuratie
const configScript = `
<script>
  // Capacitor API configuratie
  window.T4C_CONFIG = {
    // Pas dit aan naar je server adres
    API_BASE: window.location.hostname === 'localhost' 
      ? 'http://192.168.1.100:3000'  // Lokale server
      : 'https://api.transfer4cars.com', // Productie
    APP_VERSION: '1.0.0',
    PLATFORM: 'app'
  };
</script>
`;

// Injecteer in index.html
const indexPath = path.join(DEST, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace('<head>', '<head>' + configScript);
  fs.writeFileSync(indexPath, html);
}

console.log('✓ Transfer4Cars web content gekopieerd naar www/');
console.log('  Bron:', SRC);
console.log('  Doel:', DEST);
