$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

$venvDir = Join-Path $repoRoot '.venv'
$pythonExe = Join-Path $venvDir "Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
  Write-Host "Creating Python venv at $venvDir ..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $venvDir | Out-Null
  # Prefer py launcher on Windows when available (more reliable than WindowsApps python stub)
  $pyCmd = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCmd) {
    & py -3 -m venv $venvDir
  }
  else {
    python -m venv $venvDir
  }
  if (-not (Test-Path $pythonExe)) {
    Write-Host "ERROR: Failed to create venv. Install Python 3.10+ from python.org and ensure 'py' or 'python' is on PATH." -ForegroundColor Red
    exit 1
  }
}

Write-Host "Installing AI dependencies into $venvDir ..." -ForegroundColor Cyan
& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r "backend/requirements.txt"
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: pip install failed." -ForegroundColor Red
  exit 1
}

Write-Host "AI venv ready. Start with: npm run dev:ai" -ForegroundColor Green
