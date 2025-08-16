# Economy Guardian - Rotate Logs Helper (PowerShell)
# Usage examples:
#   ./rotate-logs.ps1
#   ./rotate-logs.ps1 -Dir ../logs -SizeMb 10 -AgeDays 3 -Keep 15
param(
  [string]$Dir = (Join-Path $PSScriptRoot '..' 'logs'),
  [int]$SizeMb = 5,
  [int]$AgeDays = 7,
  [int]$Keep = 10
)

$ErrorActionPreference = 'Stop'

# Resolve Node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error 'Node.js is required to run this script. Please install Node and ensure "node" is on PATH.'
  exit 1
}

$scriptPath = Join-Path $PSScriptRoot 'rotate-logs.js'

$ArgsList = @(
  '--dir', (Resolve-Path -LiteralPath $Dir).Path,
  '--size-mb', $SizeMb,
  '--age-days', $AgeDays,
  '--keep', $Keep
)

Write-Host "[rotate-logs.ps1] Running: node $scriptPath $($ArgsList -join ' ')"

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = $node.Source
$processInfo.ArgumentList.Add($scriptPath)
foreach ($a in $ArgsList) { $processInfo.ArgumentList.Add([string]$a) }
$processInfo.WorkingDirectory = (Split-Path $scriptPath)
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.UseShellExecute = $false

$p = [System.Diagnostics.Process]::Start($processInfo)
$p.WaitForExit()

Write-Output ($p.StandardOutput.ReadToEnd())
$stderr = $p.StandardError.ReadToEnd()
if ($stderr) { Write-Warning $stderr }

exit $p.ExitCode
