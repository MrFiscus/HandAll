$ErrorActionPreference = "Stop"

$venvDir = Join-Path $env:LOCALAPPDATA "HandAll\.venv"
$pythonExe = Join-Path $venvDir "Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
  New-Item -ItemType Directory -Path $venvDir -Force | Out-Null
  python -m venv $venvDir
}

& $pythonExe -m pip install -r "backend/requirements.txt"
