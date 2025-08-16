# Configure SAVEDVARS_PATH in companion/.env by auto-detecting EconomyGuardian_Accounting.lua on D:
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\companion\scripts\config-savedvars.ps1
# Optional:
#   -WowBase "D:\\World of Warcraft"
#   -Variant "_retail_"
#   -WatchMs 30000

param(
  [string]$WowBase = "D:\\World of Warcraft",
  [string]$Variant = "_retail_",
  [int]$WatchMs = 30000
)

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host "[config-savedvars] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[config-savedvars] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[config-savedvars] ERROR: $m" -ForegroundColor Red; exit 1 }

# Repo root and .env path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvPath = Join-Path $RepoRoot ".env"

# Candidate paths
$Candidates = @()
$Pattern1 = Join-Path $WowBase (Join-Path $Variant "WTF\Account\*\SavedVariables\EconomyGuardian_Accounting.lua")
$Candidates += Get-ChildItem -Path $Pattern1 -File -ErrorAction SilentlyContinue

# Additional common bases
$Bases = @(
  $WowBase,
  "D:\\World of Warcraft",
  "D:\\Games\\World of Warcraft",
  "D:\\Program Files\\World of Warcraft",
  "D:\\Program Files (x86)\\World of Warcraft",
  "D:\\WoW",
  "D:\\"
) | Select-Object -Unique

if ($Candidates.Count -eq 0) {
  foreach ($b in $Bases) {
    if (!(Test-Path $b)) { continue }
    try {
      $hits = Get-ChildItem -Path $b -Recurse -File -Filter "EconomyGuardian_Accounting.lua" -ErrorAction SilentlyContinue
      if ($hits -and $hits.Count -gt 0) { $Candidates += $hits; break }
    } catch {}
  }
}

if ($Candidates.Count -eq 0) { Fail "Could not locate EconomyGuardian_Accounting.lua under D:." }

# Pick the first candidate
$SavedVars = $Candidates[0].FullName
Info "Detected SavedVariables: $SavedVars"

# Read or create .env
$envLines = @()
if (Test-Path $EnvPath) {
  $envLines = Get-Content -Path $EnvPath -ErrorAction SilentlyContinue
}

# Update or add SAVEDVARS_PATH and SAVEDVARS_WATCH_MS
$hadPath = $false
$hadWatch = $false
for ($i=0; $i -lt $envLines.Count; $i++) {
  if ($envLines[$i] -match '^SAVEDVARS_PATH=') { $envLines[$i] = "SAVEDVARS_PATH=$SavedVars"; $hadPath = $true }
  if ($envLines[$i] -match '^SAVEDVARS_WATCH_MS=') { $envLines[$i] = "SAVEDVARS_WATCH_MS=$WatchMs"; $hadWatch = $true }
}
if (-not $hadPath) { $envLines += "SAVEDVARS_PATH=$SavedVars" }
if (-not $hadWatch) { $envLines += "SAVEDVARS_WATCH_MS=$WatchMs" }

# Write back .env
Set-Content -Path $EnvPath -Value $envLines -Encoding UTF8
Info ".env updated with SAVEDVARS_PATH and SAVEDVARS_WATCH_MS"

# Summary
Write-Host "[config-savedvars] Done." -ForegroundColor Green
