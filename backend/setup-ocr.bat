@echo off
echo === CarDatax v10.7.0 - OCR Setup Windows ===

:: Node dependencies (werkt altijd)
cd /d "%~dp0backend" 2>nul || cd backend 2>nul
npm install jimp tesseract.js

:: System tesseract via chocolatey (optioneel, sneller)
where choco >nul 2>nul
if %errorlevel%==0 (
    choco install tesseract -y
    echo ✓ System tesseract geinstalleerd
) else (
    echo ! Chocolatey niet gevonden - alleen tesseract.js fallback
    echo   Optioneel: installeer via https://github.com/UB-Mannheim/tesseract/wiki
)

echo.
echo === Klaar! Restart server: node server.js ===
pause
