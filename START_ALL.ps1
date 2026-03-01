# T4C v9.5 - Start Server + Cloudflare Tunnel
# Ctrl+C om te stoppen
# Geen Unicode, geen fancy formatting - gewoon werkend

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $scriptDir "backend"
$dataDir = Join-Path $scriptDir "data"
$cfExe = "C:\cloudflared\cloudflared.exe"

Write-Host ""
Write-Host "  T4C v9.5 - Opstarten" -ForegroundColor Green
Write-Host "  =====================" -ForegroundColor DarkGray
Write-Host ""

# --- Check Node.js ---
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCheck) {
    Write-Host "  [FOUT] Node.js niet gevonden. Installeer via nodejs.org" -ForegroundColor Red
    Read-Host "  Druk Enter"
    exit 1
}
Write-Host "  [OK] Node.js gevonden" -ForegroundColor Green

# --- Data directory ---
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}
$backupsDir = Join-Path $dataDir "backups"
if (-not (Test-Path $backupsDir)) {
    New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
}
Write-Host "  [OK] Data directory: $dataDir" -ForegroundColor Green

# --- Dependencies ---
$nmDir = Join-Path $backendDir "node_modules"
if (-not (Test-Path $nmDir)) {
    Write-Host "  [..] npm install..." -ForegroundColor Yellow
    Push-Location $backendDir
    npm install --silent 2>$null
    Pop-Location
}
Write-Host "  [OK] Dependencies" -ForegroundColor Green

# --- Kill old processes on port 3000 ---
$oldProcs = netstat -ano 2>$null | Select-String ":3000 " | Select-String "LISTENING"
foreach ($line in $oldProcs) {
    $parts = $line -split '\s+'
    $pid = $parts[-1]
    if ($pid -match '^\d+$') {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
}

# --- Start Server ---
Write-Host ""
Write-Host "  [1] Server starten..." -ForegroundColor Cyan
$serverJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    node server.js 2>&1
} -ArgumentList $backendDir

Start-Sleep -Seconds 3
Write-Host "  [OK] Server draait op http://localhost:3000" -ForegroundColor Green

# --- Start Tunnel ---
$hasTunnel = Test-Path $cfExe
$hasConfig = Test-Path "$env:USERPROFILE\.cloudflared\config.yml"
$tunnelJob = $null

if ($hasTunnel -and $hasConfig) {
    Write-Host "  [2] Cloudflare Tunnel starten..." -ForegroundColor Cyan
    $tunnelJob = Start-Job -ScriptBlock {
        param($exe)
        & $exe tunnel --retries 100 --grace-period 60s run t4c 2>&1
    } -ArgumentList $cfExe
    Start-Sleep -Seconds 2
    Write-Host "  [OK] Tunnel actief: https://dexah69.com" -ForegroundColor Green
} else {
    if (-not $hasTunnel) {
        Write-Host "  [!] cloudflared.exe niet gevonden - alleen lokaal" -ForegroundColor Yellow
    }
    if (-not $hasConfig) {
        Write-Host "  [!] Tunnel config niet gevonden - run SETUP_TUNNEL.ps1 eerst" -ForegroundColor Yellow
    }
}

# --- Status ---
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "  T4C v9.5 DRAAIT" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "  Lokaal:  http://localhost:3000/app/" -ForegroundColor White
Write-Host "  Mobiel:  http://localhost:3000/m/" -ForegroundColor White
if ($tunnelJob) {
    Write-Host "  Online:  https://dexah69.com" -ForegroundColor White
}
Write-Host ""
Write-Host "  Data:    $dataDir" -ForegroundColor DarkGray
Write-Host "  DB:      $dataDir\t4c.db" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Druk Ctrl+C om te stoppen" -ForegroundColor Yellow
Write-Host ""

# --- Keep alive + auto-restart ---
$serverRestarts = 0
$tunnelRestarts = 0

while ($true) {
    Start-Sleep -Seconds 5

    # Check server
    $serverState = (Get-Job -Id $serverJob.Id -ErrorAction SilentlyContinue).State
    if ($serverState -ne "Running") {
        $serverRestarts++
        Write-Host "  [!] Server herstart #$serverRestarts..." -ForegroundColor Yellow
        Remove-Job -Id $serverJob.Id -Force -ErrorAction SilentlyContinue
        $serverJob = Start-Job -ScriptBlock {
            param($dir)
            Set-Location $dir
            node server.js 2>&1
        } -ArgumentList $backendDir
    }

    # Check tunnel
    if ($tunnelJob) {
        $tunnelState = (Get-Job -Id $tunnelJob.Id -ErrorAction SilentlyContinue).State
        if ($tunnelState -ne "Running") {
            $tunnelRestarts++
            Write-Host "  [!] Tunnel herstart #$tunnelRestarts..." -ForegroundColor Yellow
            Remove-Job -Id $tunnelJob.Id -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
            $tunnelJob = Start-Job -ScriptBlock {
                param($exe)
                & $exe tunnel --retries 100 --grace-period 60s run t4c 2>&1
            } -ArgumentList $cfExe
        }
    }
}
