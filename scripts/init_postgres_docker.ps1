$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose could not start PostgreSQL. Open Docker Desktop and try again."
}

docker compose ps postgres
if ($LASTEXITCODE -ne 0) {
    throw "Docker PostgreSQL container is not available."
}

$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
    $status = docker inspect --format "{{.State.Health.Status}}" autojob-postgres 2>$null
    if ($status -eq "healthy") {
        $healthy = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $healthy) {
    docker logs autojob-postgres --tail 80
    throw "Docker PostgreSQL did not become healthy in time."
}

$env:DATABASE_URL = "postgresql+psycopg://autojob:autojob@localhost:5433/autojob"

@'
from autojob import db
db.init_db()
print("PostgreSQL schema initialized.")
'@ | .\.venv\Scripts\python -
if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL schema initialization failed."
}

Write-Host "Docker PostgreSQL is ready on localhost:5433."
Write-Host "Use this in .env:"
Write-Host "DATABASE_URL=postgresql+psycopg://autojob:autojob@localhost:5433/autojob"
