@echo off
chcp 65001 >nul 2>&1
title T4C Platform v10.1 - Setup
color 0A
echo.
echo   T4C PLATFORM v10.1 - SETUP
echo   ===========================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (echo   [!] Node.js niet gevonden & pause & exit /b 1)
for /f "tokens=*" %%v in ('node --version') do echo   [OK] Node.js %%v

set "ROOT=%~dp0"
if not exist "%ROOT%data" mkdir "%ROOT%data"
if not exist "%ROOT%data\backups" mkdir "%ROOT%data\backups"
if not exist "%ROOT%logs" mkdir "%ROOT%logs"
if not exist "%ROOT%updates" mkdir "%ROOT%updates"
echo   [OK] Mappen aangemaakt

echo.
echo   [1/2] Backend dependencies...
cd /d "%ROOT%backend"
if exist "node_modules" (echo   [OK] Al geinstalleerd) else (call npm install 2>nul && echo   [OK] Geinstalleerd)

if not exist "%ROOT%backend\.env" (
  if exist "%ROOT%backend\.env.example" (
    copy "%ROOT%backend\.env.example" "%ROOT%backend\.env" >nul
    echo   [OK] .env aangemaakt van .env.example
    echo   [!!] Vergeet niet je API keys in te vullen in backend\.env
  )
) else (
  echo   [OK] .env bestaat al
)

echo.
echo   [2/2] Verificatie...
if exist "%ROOT%backend\server.js" (echo   [OK] server.js) else (echo   [!!] server.js ONTBREEKT)
if exist "%ROOT%sites\cardatax\app\index.html" (echo   [OK] CardDatax portal) else (echo   [--] CardDatax portal niet gevonden)
if exist "%ROOT%sites\cardatax\m\index.html" (echo   [OK] Dealer Toolkit) else (echo   [--] Dealer Toolkit niet gevonden)
if exist "%ROOT%sites\transfer4cars\index.html" (echo   [OK] Transfer4Cars) else (echo   [--] Transfer4Cars niet gevonden)
if exist "%ROOT%sites\cardatax\admin\index.html" (echo   [OK] Admin Panel) else (echo   [--] Admin Panel niet gevonden)

cd /d "%ROOT%backend"
node --check server.js 2>nul && (echo   [OK] Syntax OK) || (echo   [!!] SYNTAX FOUT)

echo.
echo   SETUP COMPLEET! Start met START.bat
echo   Login: admin / t4c2025!
echo.
pause
