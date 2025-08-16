[CmdletBinding()]
param(
  [string]$StartCommand = 'npm run start',
  [string]$WorkingDir
)

# Robustly resolve default WorkingDir based on script location
$ScriptPath = $MyInvocation.MyCommand.Path
if (-not $WorkingDir) {
  try {
    $ScriptDir = Split-Path -Parent $ScriptPath
    $WorkingDir = (Resolve-Path (Join-Path $ScriptDir '..')).Path
  } catch {
    # Fallback: current directory
    $WorkingDir = (Get-Location).Path
  }
}

function Write-Info($msg) { Write-Host "[restart] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[restart] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[restart] $msg" -ForegroundColor Red }

try {
  Write-Info "WorkingDir: $WorkingDir"

  # 1) Backup disk-backed item names
  $dataDir = Join-Path $WorkingDir 'data'
  $namesFile = Join-Path $dataDir 'item-names.json'
  $backupDir = Join-Path $dataDir 'backups'
  if (Test-Path $namesFile) {
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
    $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupFile = Join-Path $backupDir ("item-names-$ts.json")
    Copy-Item -Path $namesFile -Destination $backupFile -Force
    Write-Info "Backed up item-names.json => $backupFile"
  } else {
    Write-Warn "No item-names.json to backup (skipping)"
  }

  # 2) Stop existing Node processes for this app (heuristic by command line path)
  $stopped = 0
  try {
    $procs = Get-CimInstance Win32_Process |
      Where-Object { $_.Name -match 'node' -and $_.CommandLine -match 'economy-guardian\\\\companion' }
    foreach ($p in $procs) {
      try {
        Write-Info "Stopping PID=$($p.ProcessId) CMD=$($p.CommandLine)"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
        $stopped++
      } catch { Write-Warn "Failed to stop PID=$($p.ProcessId): $($_.Exception.Message)" }
    }
  } catch { Write-Warn "Failed to enumerate processes: $($_.Exception.Message)" }
  Write-Info "Stopped $stopped process(es)"

  Start-Sleep -Seconds 1

  # 3) Start server
  Write-Info "Starting server with: $StartCommand"
  $psCmd = "Set-Location `"$WorkingDir`"; $StartCommand"
  $proc = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-Command",$psCmd -PassThru -WindowStyle Minimized
  if ($proc -and $proc.Id) {
    Write-Info "Launched PowerShell child PID=$($proc.Id). Server is starting in background."
  } else {
    Write-Warn "Launch may have failed (no PID captured). Check logs/console."
  }

  Write-Info "Done."
} catch {
  Write-Err $_
  exit 1
}
