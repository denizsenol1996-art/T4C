# ╔══════════════════════════════════════════╗
# ║  T4C — Cloudflare Tunnel Setup          ║
# ║  Voer uit als Administrator              ║
# ╚══════════════════════════════════════════╝

$ErrorActionPreference = "Continue"
$cfDir = "C:\cloudflared"
$cfExe = "$cfDir\cloudflared.exe"
$cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

Write-Host ""
Write-Host "  T4C Tunnel Setup" -ForegroundColor Green
Write-Host "  =================" -ForegroundColor DarkGray
Write-Host ""

# ── STAP 1: Download cloudflared ──
if (Test-Path $cfExe) {
    Write-Host "[OK] cloudflared al gevonden op $cfExe" -ForegroundColor Green
    & $cfExe --version
} else {
    Write-Host "[1/5] Cloudflared downloaden..." -ForegroundColor Yellow
    if (-not (Test-Path $cfDir)) { New-Item -ItemType Directory -Path $cfDir -Force | Out-Null }
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $cfUrl -OutFile $cfExe -UseBasicParsing
        Unblock-File -Path $cfExe
        Write-Host "[OK] cloudflared gedownload naar $cfExe" -ForegroundColor Green
        & $cfExe --version
    } catch {
        Write-Host "[FOUT] Download mislukt. Download handmatig:" -ForegroundColor Red
        Write-Host "  $cfUrl" -ForegroundColor Cyan
        Write-Host "  Zet het bestand in $cfDir" -ForegroundColor Cyan
        Read-Host "Druk Enter om af te sluiten"
        exit 1
    }
}

Write-Host ""

# ── STAP 2: Login bij Cloudflare ──
Write-Host "[2/5] Inloggen bij Cloudflare..." -ForegroundColor Yellow
Write-Host "  -> Er opent een browser. Kies je domein en autoriseer." -ForegroundColor DarkGray
Write-Host ""
& $cfExe tunnel login

if ($LASTEXITCODE -ne 0) {
    Write-Host "[FOUT] Login mislukt. Probeer opnieuw." -ForegroundColor Red
    Read-Host "Druk Enter om af te sluiten"
    exit 1
}
Write-Host "[OK] Ingelogd bij Cloudflare" -ForegroundColor Green
Write-Host ""

# ── STAP 3: Tunnel aanmaken ──
Write-Host "[3/5] Tunnel aanmaken..." -ForegroundColor Yellow

# Check of tunnel al bestaat
$existing = & $cfExe tunnel list 2>&1 | Select-String "t4c"
if ($existing) {
    Write-Host "[OK] Tunnel 't4c' bestaat al" -ForegroundColor Green
    $tunnelLine = $existing.ToString()
    # Extract tunnel ID (first UUID-like string)
    if ($tunnelLine -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
        $tunnelId = $matches[1]
    }
} else {
    $result = & $cfExe tunnel create t4c 2>&1
    Write-Host $result
    if ($result -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
        $tunnelId = $matches[1]
    }
    Write-Host "[OK] Tunnel aangemaakt" -ForegroundColor Green
}

if (-not $tunnelId) {
    Write-Host "[FOUT] Kon tunnel ID niet vinden. Check 'cloudflared tunnel list'" -ForegroundColor Red
    & $cfExe tunnel list
    Read-Host "Druk Enter om af te sluiten"
    exit 1
}

Write-Host "  Tunnel ID: $tunnelId" -ForegroundColor Cyan
Write-Host ""

# ── STAP 4: Domein koppelen ──
Write-Host "[4/5] Domein koppelen..." -ForegroundColor Yellow
$domain = Read-Host "  Voer je domein in [standaard: dexah69.com]"
if ([string]::IsNullOrWhiteSpace($domain)) { $domain = "dexah69.com" }

if ([string]::IsNullOrWhiteSpace($domain)) {
    Write-Host "  Geen domein opgegeven, je kunt dit later doen met:" -ForegroundColor DarkGray
    Write-Host "  $cfExe tunnel route dns t4c jouwdomein.nl" -ForegroundColor Cyan
} else {
    Write-Host "  DNS route aanmaken voor $domain..." -ForegroundColor DarkGray
    & $cfExe tunnel route dns t4c $domain
    Write-Host "[OK] $domain gekoppeld aan tunnel" -ForegroundColor Green
}
Write-Host ""

# ── STAP 5: Config aanmaken ──
Write-Host "[5/5] Config bestand aanmaken..." -ForegroundColor Yellow

$cfHome = "$env:USERPROFILE\.cloudflared"
$configPath = "$cfHome\config.yml"
$credFile = "$cfHome\$tunnelId.json"

if (-not $domain) { $domain = "dexah69.com" }

$configContent = @"
tunnel: $tunnelId
credentials-file: $credFile

retries: 100
grace-period: 60s
protocol: quic

originRequest:
  connectTimeout: 30s
  tcpKeepAlive: 30s
  keepAliveTimeout: 90s
  keepAliveConnections: 4

ingress:
  - hostname: $domain
    service: http://localhost:3000
    originRequest:
      connectTimeout: 30s
  - service: http_status:404
"@

# Backup existing config
if (Test-Path $configPath) {
    Copy-Item $configPath "$configPath.backup" -Force
    Write-Host "  Bestaande config gebackupt naar config.yml.backup" -ForegroundColor DarkGray
}

Set-Content -Path $configPath -Value $configContent -Encoding UTF8
Write-Host "[OK] Config opgeslagen: $configPath" -ForegroundColor Green
Write-Host ""

# ── KLAAR ──
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "  SETUP COMPLEET!" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Tunnel ID:  $tunnelId" -ForegroundColor Cyan
Write-Host "  Domein:     $domain" -ForegroundColor Cyan
Write-Host "  Config:     $configPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "  OPSTARTEN:" -ForegroundColor Yellow
Write-Host "  Gebruik START_ALL.ps1 om T4C + tunnel samen te starten" -ForegroundColor White
Write-Host "  Of handmatig:" -ForegroundColor DarkGray
Write-Host "    Terminal 1: .\START_T4C.ps1" -ForegroundColor DarkGray
Write-Host "    Terminal 2: $cfExe tunnel run t4c" -ForegroundColor DarkGray
Write-Host ""

# Save tunnel info for START_ALL script
$infoPath = Join-Path $PSScriptRoot "tunnel_info.txt"
Set-Content -Path $infoPath -Value "$tunnelId`n$domain" -Encoding UTF8

Read-Host "Druk Enter om af te sluiten"
