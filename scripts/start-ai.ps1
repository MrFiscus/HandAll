$ErrorActionPreference = "Stop"

# Repo root (parent of scripts/)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

# Prefer project-local .venv (standard, in .gitignore). Fall back to legacy %LOCALAPPDATA%\HandAll\.venv.
$venvRepo = Join-Path $repoRoot '.venv'
$venvLegacy = Join-Path $env:LOCALAPPDATA 'HandAll\.venv'

$venvDir = $null
if (Test-Path (Join-Path $venvRepo 'Scripts\python.exe')) {
  $venvDir = $venvRepo
}
elseif (Test-Path (Join-Path $venvLegacy 'Scripts\python.exe')) {
  $venvDir = $venvLegacy
  Write-Host "Using legacy venv: $venvLegacy (create $venvRepo with npm run install-all to standardize)" -ForegroundColor Yellow
}

if (-not $venvDir) {
  Write-Host ""
  Write-Host "ERROR: HandAll AI backend cannot start - no Python venv found." -ForegroundColor Red
  Write-Host "  Expected: $venvRepo\Scripts\python.exe" -ForegroundColor Gray
  Write-Host "  Fix from repo root:  npm run install-all" -ForegroundColor Yellow
  Write-Host "  Or:  powershell -ExecutionPolicy Bypass -File scripts\setup-ai.ps1" -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

$pythonExe = Join-Path $venvDir "Scripts\python.exe"
$uvicornExe = Join-Path $venvDir "Scripts\uvicorn.exe"
$envFile = Join-Path $repoRoot ".env"

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $parts = $line -split "=", 2
    if ($parts.Length -ne 2) {
      return
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

if (-not $env:SUPABASE_KEY -and $env:SUPABASE_ANON_KEY) {
  [System.Environment]::SetEnvironmentVariable("SUPABASE_KEY", $env:SUPABASE_ANON_KEY, "Process")
}

if (-not (Test-Path $uvicornExe)) {
  Write-Host "Installing uvicorn / AI dependencies into venv..." -ForegroundColor Yellow
  & $pythonExe -m pip install -r "backend/requirements.txt"
}
else {
  # Avoid PowerShell mangling of python -c one-liners (was causing NameError on probe).
  $pyProbe = @'
import importlib
for _name in (
    "uvicorn",
    "fastapi",
    "google.oauth2",
    "googleapiclient.discovery",
    "langchain_openai",
    "tzdata",
):
    importlib.import_module(_name)
'@
  & $pythonExe -c $pyProbe
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Refreshing AI Python dependencies..." -ForegroundColor Yellow
    & $pythonExe -m pip install -r "backend/requirements.txt"
  }
}

if ($LASTEXITCODE -ne 0) {
  & $pythonExe -m pip install -r "backend/requirements.txt"
}

if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: pip install failed. Check backend/requirements.txt and network." -ForegroundColor Red
  exit 1
}

Write-Host "Starting HandAll AI (FastAPI) at http://127.0.0.1:8011  (cwd: $repoRoot)" -ForegroundColor Green
& $pythonExe -m uvicorn "backend.main:app" --host 127.0.0.1 --port 8011
