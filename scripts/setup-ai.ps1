$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

$venvDir = Join-Path $repoRoot '.venv'
$pythonExe = Join-Path $venvDir "Scripts\python.exe"

# HandAll AI stack: FastAPI/Pydantic/LangChain - use CPython 3.10-3.12.
# Python 3.13+ (incl. 3.14) often breaks or lacks wheels for pydantic-core binaries.
$supportedTags = @('-3.12', '-3.11', '-3.10')

function Test-PyLauncherVersion {
  param([string]$Tag)
  & py $Tag -c 'import sys' 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Get-PyLauncherTag {
  foreach ($tag in $supportedTags) {
    if (Test-PyLauncherVersion -Tag $tag) {
      return $tag
    }
  }
  return $null
}

function New-VenvWithPreferredPython {
  param([string]$TargetDir)
  $tag = Get-PyLauncherTag
  if (-not $tag) {
    Write-Host ""
    Write-Host "ERROR: No supported Python found via the 'py' launcher." -ForegroundColor Red
    Write-Host "  Install Python 3.12 or 3.11 from https://www.python.org/downloads/" -ForegroundColor Gray
    Write-Host "  During setup, enable 'py launcher' and 'Add Python to PATH'." -ForegroundColor Gray
    Write-Host ""
    exit 1
  }
  Write-Host "Creating venv with py $tag ..." -ForegroundColor Cyan
  & py $tag -m venv $TargetDir
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: py $tag -m venv failed." -ForegroundColor Red
    exit 1
  }
}

function Test-VenvPythonSupported {
  param([string]$PyPath)
  if (-not (Test-Path $PyPath)) { return $false }
  # Single-quoted: PowerShell parses [:2] inside double quotes as wildcard/type syntax.
  $code = 'import sys; raise SystemExit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)'
  & $PyPath -c $code 2>$null
  return ($LASTEXITCODE -eq 0)
}

if (Test-Path $pythonExe) {
  if (-not (Test-VenvPythonSupported -PyPath $pythonExe)) {
    Write-Host ""
    Write-Host "This .venv uses an unsupported Python (need 3.10-3.12). Recreating venv..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $venvDir
  }
}

if (-not (Test-Path $pythonExe)) {
  $pyCmd = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCmd) {
    New-VenvWithPreferredPython -TargetDir $venvDir
  }
  else {
    Write-Host "Creating venv with 'python -m venv' (no py launcher) ..." -ForegroundColor Yellow
    python -m venv $venvDir
  }
  if (-not (Test-Path $pythonExe)) {
    Write-Host "ERROR: Failed to create venv. Install Python 3.11 or 3.12 from python.org." -ForegroundColor Red
    exit 1
  }
  if (-not (Test-VenvPythonSupported -PyPath $pythonExe)) {
    Write-Host "ERROR: 'python' on PATH is not 3.10-3.12. Install 3.12 and use the py launcher, or run setup again after installing." -ForegroundColor Red
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

& $pythonExe (Join-Path $PSScriptRoot "ai_import_probe.py")
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: Post-install import check failed. Try deleting .venv and run this script again." -ForegroundColor Red
  exit 1
}

Write-Host "AI venv ready. Start with: npm run dev:ai" -ForegroundColor Green
