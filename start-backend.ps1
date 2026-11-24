$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

python -m uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
