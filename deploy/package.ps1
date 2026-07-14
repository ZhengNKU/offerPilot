#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Local package script - build Docker images and export .tar for server deployment.
.DESCRIPTION
  Run from project root:
    .\deploy\package.ps1 -Service backend
    .\deploy\package.ps1 -Service frontend
    .\deploy\package.ps1 -Service all
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("backend", "frontend", "all")]
    [string]$Service
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$scriptDir   = Join-Path $PWD "deploy"
$projectRoot = $PWD.Path
$packagesDir = Join-Path $scriptDir "packages"
$composeFile = Join-Path $scriptDir "docker-compose.yml"
$envFile     = Join-Path $projectRoot "backend\.env"

# ---- read PROJECT_VERSION from backend\.env ----
$projectVersion = $null
if (Test-Path $envFile) {
    $match = Get-Content $envFile -Encoding UTF8 |
        Where-Object { $_ -match '^PROJECT_VERSION=(.*)' } |
        Select-Object -First 1
    if ($match) {
        $projectVersion = ($match -split '=', 2)[1].Trim()
    }
}
if (-not $projectVersion) {
    Write-Host "ERROR: PROJECT_VERSION not found in backend\.env" -ForegroundColor Red
    exit 1
}

# export for docker compose variable substitution
$env:PROJECT_VERSION = $projectVersion

if (-not (Test-Path $packagesDir)) {
    New-Item -ItemType Directory -Path $packagesDir | Out-Null
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  offerPilot Local Package" -ForegroundColor Cyan
Write-Host "  Target : $Service" -ForegroundColor Cyan
Write-Host "  Version: $projectVersion" -ForegroundColor Cyan
Write-Host "  Output : $packagesDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---- backend ----
function Build-Backend {
    Write-Host "[1/3] Building backend image (offerpilot-backend:$projectVersion) ..." -ForegroundColor Yellow
    docker compose -f $composeFile build backend
    if ($LASTEXITCODE -ne 0) { throw "backend build failed" }

    Write-Host "[2/3] Exporting backend.tar ..." -ForegroundColor Yellow
    docker save -o "$packagesDir\backend.tar" "offerpilot-backend:$projectVersion"
    if ($LASTEXITCODE -ne 0) { throw "backend export failed" }

    $size = (Get-Item "$packagesDir\backend.tar").Length / 1MB
    Write-Host "[3/3] Done  (backend.tar  $([math]::Round($size, 1)) MB)" -ForegroundColor Green
    Write-Host ""
}

# ---- frontend ----
function Build-Frontend {
    Write-Host "[1/3] Building frontend image (offerpilot-frontend:$projectVersion) ..." -ForegroundColor Yellow
    docker compose -f $composeFile build frontend
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

    Write-Host "[2/3] Exporting frontend.tar ..." -ForegroundColor Yellow
    docker save -o "$packagesDir\frontend.tar" "offerpilot-frontend:$projectVersion"
    if ($LASTEXITCODE -ne 0) { throw "frontend export failed" }

    $size = (Get-Item "$packagesDir\frontend.tar").Length / 1MB
    Write-Host "[3/3] Done  (frontend.tar  $([math]::Round($size, 1)) MB)" -ForegroundColor Green
    Write-Host ""
}

# ---- run ----
Push-Location $scriptDir
try {
    switch ($Service) {
        "backend"  { Build-Backend }
        "frontend" { Build-Frontend }
        "all"      { Build-Backend; Build-Frontend }
    }
}
finally {
    Pop-Location
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Done. Upload to server:" -ForegroundColor Cyan
Write-Host "  scp $packagesDir\*.tar ubuntu@124.223.185.108:/data/offerPilot/packages/" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
