@echo off
chcp 65001 >nul 2>&1
title T4C Smart Updater v10
color 0A

echo.
echo  ==========================================
echo   T4C SMART UPDATER v10
echo   Per-bestand updates - database veilig
echo  ==========================================
echo.

set "ROOT=%~dp0"
set "UPDATES=%ROOT%updates"
set "BACKUP_DIR=%ROOT%data\backups"
set "BACKEND=%ROOT%backend"

if not exist "%UPDATES%" mkdir "%UPDATES%"

:: Find zip
set "ZIPFILE="
set "ZIPCOUNT=0"
for %%f in ("%UPDATES%\*.zip") do (set "ZIPFILE=%%f" & set /a ZIPCOUNT+=1)

if "%ZIPFILE%"=="" (
    echo  [!] Geen .zip gevonden in updates\
    echo  Zet je update zip in: %UPDATES%
    pause & exit /b 0
)
if %ZIPCOUNT% GTR 1 (
    echo  [!] Meerdere zips gevonden - zorg dat er 1 in staat
    pause & exit /b 1
)

for %%f in ("%ZIPFILE%") do echo  [OK] Update: %%~nxf
echo.

:: STAP 1: Backup
echo  [1/5] Database backup...
if exist "%ROOT%data\t4c.db" (
    if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
    for /f "tokens=1-6 delims=/-:. " %%a in ('echo %date% %time%') do set "TS=%%a%%b%%c-%%d%%e%%f"
    copy "%ROOT%data\t4c.db" "%BACKUP_DIR%\pre-update-%TS%.db" >nul 2>&1
    echo  [OK] Backup gemaakt
) else (echo  [OK] Geen database - skip)

:: STAP 2: Stop server
echo  [2/5] Server stoppen...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING" 2^>nul') do taskkill /PID %%p /F >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq T4C*" >nul 2>&1
timeout /t 2 /nobreak >nul
echo  [OK] Server gestopt

:: STAP 3: Uitpakken
echo  [3/5] Uitpakken...
set "TEMP=%UPDATES%\_temp"
if exist "%TEMP%" rmdir /s /q "%TEMP%"
mkdir "%TEMP%"
powershell -NoProfile -Command "Expand-Archive -Path '%ZIPFILE%' -DestinationPath '%TEMP%' -Force" 2>nul
if %errorlevel% neq 0 (echo  [FOUT] Zip uitpakken mislukt! & pause & exit /b 1)

:: Find root in extracted zip
set "SRC=%TEMP%"
for /d %%d in ("%TEMP%\*") do (
    if exist "%%d\backend\server.js" set "SRC=%%d"
    if exist "%%d\manifest.json" set "SRC=%%d"
    for /d %%e in ("%%d\*") do (
        if exist "%%e\backend\server.js" set "SRC=%%e"
    )
)
echo  [OK] Update content gevonden

:: STAP 4: Smart copy (per bestand, NOOIT data/ of node_modules/)
echo  [4/5] Bestanden bijwerken...
set "UPDATED=0"

:: Backend JS files
if exist "%SRC%\backend" (
    for %%f in ("%SRC%\backend\*.js") do (
        copy /y "%%f" "%BACKEND%\" >nul 2>&1
        echo         + backend\%%~nxf
        set /a UPDATED+=1
    )
    if exist "%SRC%\backend\package.json" (
        copy /y "%SRC%\backend\package.json" "%BACKEND%\" >nul 2>&1
        echo         + backend\package.json
    )
)

:: Sites - CardDatax
if exist "%SRC%\sites\cardatax" (
    xcopy /s /y /q "%SRC%\sites\cardatax\*" "%ROOT%sites\cardatax\" >nul 2>&1
    echo         + sites\cardatax\ (bijgewerkt)
    set /a UPDATED+=1
)

:: Sites - Transfer4Cars
if exist "%SRC%\sites\transfer4cars" (
    xcopy /s /y /q "%SRC%\sites\transfer4cars\*" "%ROOT%sites\transfer4cars\" >nul 2>&1
    echo         + sites\transfer4cars\ (bijgewerkt)
    set /a UPDATED+=1
)

:: Root files (bat, manifest, etc)
for %%f in ("%SRC%\*.bat") do (copy /y "%%f" "%ROOT%" >nul 2>&1 & echo         + %%~nxf)
for %%f in ("%SRC%\*.json") do (copy /y "%%f" "%ROOT%" >nul 2>&1 & echo         + %%~nxf)

:: Frontend source (optional)
if exist "%SRC%\frontend" (
    xcopy /s /y /q "%SRC%\frontend\src\*" "%ROOT%frontend\src\" >nul 2>&1
    if exist "%SRC%\frontend\vite.config.ts" copy /y "%SRC%\frontend\vite.config.ts" "%ROOT%frontend\" >nul 2>&1
    echo         + frontend\ source
)

echo  [OK] Bestanden bijgewerkt

:: STAP 5: Opruimen
echo  [5/5] Opruimen...
cd /d "%ROOT%"
rmdir /s /q "%TEMP%" 2>nul
if not exist "%UPDATES%\applied" mkdir "%UPDATES%\applied"
for %%f in ("%ZIPFILE%") do move /y "%ZIPFILE%" "%UPDATES%\applied\%%~nxf" >nul 2>&1

:: Dependencies check
cd /d "%BACKEND%"
call npm install --production --silent 2>nul

echo.
echo  ==========================================
echo   UPDATE COMPLEET!
echo  ------------------------------------------
echo   Database:  NIET AANGERAAKT
echo   Backup:    data\backups\
echo   Start met: START.bat
echo  ==========================================
echo.
set /p STARTNU="  Direct starten? (j/n): "
if /i "%STARTNU%"=="j" call "%ROOT%START.bat"
pause
