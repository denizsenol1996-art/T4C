###############################################
#  T4C Updater — Code update, data preserved  #
###############################################

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   T4C UPDATE v9.5" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# ── 1. Backup database ──
$dbPath = Join-Path $root "data\t4c.db"
$backupDir = Join-Path $root "data\backups"

if (Test-Path $dbPath) {
    Write-Host "  [OK] Database gevonden: $dbPath" -ForegroundColor Green
    $size = [math]::Round((Get-Item $dbPath).Length / 1KB, 1)
    Write-Host "  [OK] Database grootte: ${size} KB" -ForegroundColor Green
    
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
    $ts = Get-Date -Format "yyyy-MM-dd-HHmm"
    $backupFile = Join-Path $backupDir "pre-update-$ts.db"
    Copy-Item $dbPath $backupFile
    Write-Host "  [OK] Backup: $backupFile" -ForegroundColor Green
    
    # Clean old backups (keep last 10)
    $backups = Get-ChildItem $backupDir -Filter "*.db" | Sort-Object LastWriteTime -Descending
    if ($backups.Count -gt 10) {
        $backups | Select-Object -Skip 10 | ForEach-Object { Remove-Item $_.FullName -Force }
        Write-Host "  [OK] Oude backups opgeschoond (max 10 bewaard)" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  [..] Geen database — eerste installatie" -ForegroundColor Yellow
}

# ── 2. Stop running server ──
Write-Host ""
Write-Host "  [..] Server stoppen..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -like "*T4C*" -or $_.CommandLine -like "*server.js*"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# ── 3. Install dependencies ──
Write-Host "  [..] Dependencies installeren..." -ForegroundColor Yellow
Push-Location (Join-Path $root "backend")
& npm install --production 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Dependencies geinstalleerd" -ForegroundColor Green
} else {
    Write-Host "  [!!] npm install fout — probeer handmatig: cd backend && npm install" -ForegroundColor Red
}
Pop-Location

# ── 4. Verify ──
Write-Host ""
$checks = @(
    @{ Path = "backend\server.js"; Name = "Server" },
    @{ Path = "backend\db.js"; Name = "Database module" },
    @{ Path = "backend\public\app\index.html"; Name = "Frontend build" }
)
$allOk = $true
foreach ($check in $checks) {
    $p = Join-Path $root $check.Path
    if (Test-Path $p) {
        Write-Host "  [OK] $($check.Name)" -ForegroundColor Green
    } else {
        Write-Host "  [!!] $($check.Name) ONTBREEKT: $($check.Path)" -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
if ($allOk) {
    Write-Host "   UPDATE COMPLEET" -ForegroundColor Green
} else {
    Write-Host "   UPDATE MET WAARSCHUWINGEN" -ForegroundColor Yellow
}
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Data:      $root\data\" -ForegroundColor White
Write-Host "  Database:  $root\data\t4c.db" -ForegroundColor White
Write-Host "  Backups:   $root\data\backups\" -ForegroundColor White
Write-Host ""
Write-Host "  Start T4C:  .\START.bat" -ForegroundColor White
Write-Host ""
Read-Host "  Druk op Enter om te sluiten"
