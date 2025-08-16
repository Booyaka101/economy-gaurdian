# Deploy EconomyGuardian_Accounting addon to WoW AddOns on D: drive
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\companion\scripts\deploy-addon.ps1
# Optional parameters:
#   -WowBase "D:\\World of Warcraft"
#   -Variant "_retail_"            # or _classic_, _classic_era_
#   -AddOnsDir "D:\\World of Warcraft\\_retail_\\Interface\\AddOns"
# The script tries sensible defaults and falls back to detected paths.

param(
  [string]$WowBase = "D:\\World of Warcraft",
  [string]$Variant = "_retail_",
  [string]$AddOnsDir = ""
)

$ErrorActionPreference = "Stop"

function Info($msg) { Write-Host "[deploy-addon] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[deploy-addon] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[deploy-addon] ERROR: $msg" -ForegroundColor Red; exit 1 }

# Determine source addon directory
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$AddonSrc = Join-Path $RepoRoot "addon\EconomyGuardian_Accounting"
if (!(Test-Path $AddonSrc)) { Fail "Addon source not found at $AddonSrc" }

# Resolve AddOns target directory
function Find-AddOnsDir() {
  if ($AddOnsDir -ne "") { if (Test-Path $AddOnsDir) { return $AddOnsDir } }
  $bases = @(
    $WowBase,
    "D:\\World of Warcraft",
    "D:\\Games\\World of Warcraft",
    "D:\\Program Files\\World of Warcraft",
    "D:\\Program Files (x86)\\World of Warcraft",
    "D:\\Battle.net\\World of Warcraft"
  ) | Select-Object -Unique
  $variants = @("_retail_","_classic_","_classic_era_")
  # 1) Direct known patterns
  foreach ($b in $bases) {
    foreach ($v in $variants) {
      $p = Join-Path $b (Join-Path $v "Interface\AddOns")
      if (Test-Path $p) { return $p }
    }
  # 1b) Discover additional bases on D: matching *World of Warcraft*
  try {
    $wowDirs = Get-ChildItem -Path 'D:\' -Directory -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like '*World of Warcraft*' -or $_.FullName -like '*World of Warcraft*' }
    foreach ($wd in $wowDirs) {
      foreach ($v in $variants) {
        $p = Join-Path $wd.FullName (Join-Path $v 'Interface\AddOns')
        if (Test-Path $p) { return $p }
      }
    }
  } catch {}
  }
  # 2) Recursive search under bases (limited to World of Warcraft trees)
  foreach ($b in $bases) {
    if (!(Test-Path $b)) { continue }
    try {
      $hits = Get-ChildItem -Path $b -Directory -Recurse -ErrorAction SilentlyContinue
      foreach ($h in $hits) {
        $full = $h.FullName
        if (($h.Name -ieq 'AddOns') -and ($full -match "\\Interface\\AddOns$") -and ($full -match "_retail_|_classic_|_classic_era_")) {
          return $full
        }
      }
    } catch {}
  }
  return $null
}

$TargetAddOns = Find-AddOnsDir
if (-not $TargetAddOns) { Fail "Could not determine AddOns directory after probing common locations on D:. Try passing -AddOnsDir explicitly." }

# Ensure target exists
if (!(Test-Path $TargetAddOns)) {
  Info "Creating AddOns directory: $TargetAddOns"
  New-Item -ItemType Directory -Force -Path $TargetAddOns | Out-Null
}

$AddonName = "EconomyGuardian_Accounting"
$TargetAddonDir = Join-Path $TargetAddOns $AddonName

# Backup existing addon if present
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (Test-Path $TargetAddonDir) {
  $BackupDir = Join-Path (Split-Path -Parent $TargetAddonDir) ("${AddonName}-backup-" + $timestamp)
  Info "Backing up existing addon to: $BackupDir"
  Copy-Item -Path $TargetAddonDir -Destination $BackupDir -Recurse -Force
}

# Copy files
Info "Deploying addon from $AddonSrc to $TargetAddonDir"
if (Test-Path $TargetAddonDir) { Remove-Item -Recurse -Force -Path $TargetAddonDir }
New-Item -ItemType Directory -Force -Path $TargetAddonDir | Out-Null

# Copy all files from source to target
Get-ChildItem -Path $AddonSrc -Recurse | ForEach-Object {
  $rel = $_.FullName.Substring($AddonSrc.Length).TrimStart("\\/")
  $dest = Join-Path $TargetAddonDir $rel
  if ($_.PSIsContainer) {
    if (!(Test-Path $dest)) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
  } else {
    Copy-Item -Path $_.FullName -Destination $dest -Force
  }
}

# Read companion/.env for dashboard port
$EnvPath = Join-Path $RepoRoot ".env"
$Port = 3000
if (Test-Path $EnvPath) {
  try {
    $pairs = @{}
    $lines = Get-Content -Path $EnvPath -ErrorAction SilentlyContinue
    foreach ($ln in $lines) {
      if (-not $ln) { continue }
      $trim = $ln.Trim()
      if ($trim -eq "" -or $trim.StartsWith('#')) { continue }
      $eq = $trim.IndexOf('=')
      if ($eq -lt 1) { continue }
      $k = $trim.Substring(0, $eq).Trim()
      $v = $trim.Substring($eq + 1).Trim()
      if ($v.Length -ge 2) {
        if (($v[0] -eq [char]34) -and ($v[$v.Length-1] -eq [char]34)) { $v = $v.Substring(1, $v.Length-2) }
        elseif (($v[0] -eq [char]39) -and ($v[$v.Length-1] -eq [char]39)) { $v = $v.Substring(1, $v.Length-2) }
      }
      $pairs[$k] = $v
    }
    if ($pairs.ContainsKey('SERVER_PORT') -and ($pairs['SERVER_PORT'] -match '^[0-9]+$')) { $Port = [int]$pairs['SERVER_PORT'] }
    elseif ($pairs.ContainsKey('PORT') -and ($pairs['PORT'] -match '^[0-9]+$')) { $Port = [int]$pairs['PORT'] }
    Info "Detected dashboard port $Port from $EnvPath"
  } catch {
    Warn ("Failed to parse $EnvPath; using default port $Port. " + $_.Exception.Message)
  }
} else {
  Warn "No .env at $EnvPath; using default port $Port"
}

# Template Link.lua from Link.lua.in, or patch Link.lua as fallback
$TemplatePath = Join-Path $AddonSrc 'Link.lua.in'
$DeployedLink = Join-Path $TargetAddonDir 'Link.lua'
if (Test-Path $TemplatePath) {
  try {
    $content = Get-Content -Path $TemplatePath -Raw
    $content = $content -replace '__PORT__', [string]$Port
    Set-Content -Path $DeployedLink -Value $content -Encoding UTF8
    Info "Wrote Link.lua from template with port $Port"
  } catch {
    Warn ("Failed to write Link.lua from template: " + $_.Exception.Message)
  }
} elseif (Test-Path $DeployedLink) {
  try {
    $lua = Get-Content -Path $DeployedLink -Raw
    $lua = $lua -replace 'http://localhost:\d+', ('http://localhost:' + [string]$Port)
    Set-Content -Path $DeployedLink -Value $lua -Encoding UTF8
    Info "Patched existing Link.lua to port $Port"
  } catch {
    Warn ("Failed to patch existing Link.lua: " + $_.Exception.Message)
  }
} else {
  Warn "No Link.lua or template found to port-templatize."
}

# Summary
Info "Deployed to: $TargetAddonDir"
Info "Done."
