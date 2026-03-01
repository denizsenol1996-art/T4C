@echo off
chcp 65001 >nul 2>&1
title T4C Platform v10.1
color 0A
echo.
echo   T4C Platform v10.1
echo   ====================
echo   CardDatax + Transfer4Cars
echo.

set "ROOT=%~dp0"

:: Find server
if exist "%ROOT%backend\server.js" (
    set "APP=%ROOT%backend"
) else (
    echo   [FOUT] server.js niet gevonden
    pause & exit /b 1
)

:: Create dirs
if not exist "%ROOT%data" mkdir "%ROOT%data"
if not exist "%ROOT%logs" mkdir "%ROOT%logs"

:: Check dependencies
if not exist "%APP%\node_modules" (
    echo   [!] Dependencies niet gevonden - run SETUP.bat eerst
    pause & exit /b 1
)

:: Kill old server
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>&1

cd /d "%APP%"

:: Cloudflare tunnel
if exist "C:\cloudflared\cloudflared.exe" (
    if exist "%USERPROFILE%\.cloudflared\config.yml" (
        echo   [OK] Cloudflare Tunnel starten...
        start "" /b cmd /c "C:\cloudflared\cloudflared.exe tunnel --retries 100 --grace-period 60s run t4c >nul 2>&1"
        echo   [OK] https://transfer4cars.com
        echo   [OK] https://cardatax.nl
    )
)

echo.
echo   LOKAAL:
echo   http://localhost:3000/app/       CardDatax Desktop
echo   http://localhost:3000/m/         Dealer Toolkit
echo   http://localhost:3000/verkoop/   Transfer4Cars
echo.

:: Start with Guardian
if exist "%APP%\guardian.js" (
    echo   Guardian bewaakt de server - Ctrl+C om te stoppen
    echo.
    node guardian.js
) else (
    node server.js
)

echo.
echo   Server gestopt.
pause
