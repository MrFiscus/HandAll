$ErrorActionPreference = "Stop"

$venvDir = Join-Path $env:LOCALAPPDATA "HandAll\.venv"
$pythonExe = Join-Path $venvDir "Scripts\python.exe"
$uvicornExe = Join-Path $venvDir "Scripts\uvicorn.exe"
$envFile = Join-Path (Get-Location) ".env"

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

if (-not (Test-Path $pythonExe)) {
  Write-Error "Python environment not found. Run 'npm run install-all' first."
}

if (-not (Test-Path $uvicornExe)) {
  & $pythonExe -m pip install -r "backend/requirements.txt"
}

& $pythonExe -m uvicorn "backend.main:app" --port 8011
