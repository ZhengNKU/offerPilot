<#
.SYNOPSIS
  本地打包脚本 —— 构建 Docker 镜像并导出 .tar，用于上传到服务器换包。
.DESCRIPTION
  在项目根目录执行：
    .\deploy\package.ps1 -Service backend    只打后端
    .\deploy\package.ps1 -Service frontend   只打前端
    .\deploy\package.ps1 -Service all        两个都打

  .tar 产物输出到 deploy\packages\，自动创建目录。
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("backend", "frontend", "all")]
    [string]$Service
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path "$scriptDir\.."
$packagesDir = "$scriptDir\packages"
$composeFile = "$scriptDir\docker-compose.yml"

# 创建输出目录
if (-not (Test-Path $packagesDir)) {
    New-Item -ItemType Directory -Path $packagesDir | Out-Null
}

Write-Host "" ======================================== -ForegroundColor Cyan
Write-Host "  offerPilot 本地打包" -ForegroundColor Cyan
Write-Host "  目标: $Service" -ForegroundColor Cyan
Write-Host "  输出: $packagesDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 后端 ──
function Build-Backend {
    Write-Host "[1/3] 构建 backend 镜像..." -ForegroundColor Yellow
    docker compose -f $composeFile build backend
    if ($LASTEXITCODE -ne 0) { throw "backend 构建失败" }

    Write-Host "[2/3] 导出 backend.tar..." -ForegroundColor Yellow
    docker save -o "$packagesDir\backend.tar" offerpilot-backend:latest
    if ($LASTEXITCODE -ne 0) { throw "backend 导出失败" }

    Write-Host "[3/3] 完成!" -ForegroundColor Green
    $size = (Get-Item "$packagesDir\backend.tar").Length / 1MB
    Write-Host "       backend.tar  $([math]::Round($size, 1)) MB" -ForegroundColor White
    Write-Host ""
}

# ── 前端 ──
function Build-Frontend {
    $env:NEXT_PUBLIC_API_BASE = ""

    Write-Host "[1/3] 构建 frontend 镜像..." -ForegroundColor Yellow
    docker compose -f $composeFile build frontend
    if ($LASTEXITCODE -ne 0) { throw "frontend 构建失败" }

    Write-Host "[2/3] 导出 frontend.tar..." -ForegroundColor Yellow
    docker save -o "$packagesDir\frontend.tar" offerpilot-frontend:latest
    if ($LASTEXITCODE -ne 0) { throw "frontend 导出失败" }

    Write-Host "[3/3] 完成!" -ForegroundColor Green
    $size = (Get-Item "$packagesDir\frontend.tar").Length / 1MB
    Write-Host "       frontend.tar  $([math]::Round($size, 1)) MB" -ForegroundColor White
    Write-Host ""
}

# ── 执行 ──
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
Write-Host "  打包完成！上传到服务器：" -ForegroundColor Cyan
Write-Host "  scp $packagesDir\*.tar ubuntu@124.223.185.108:/data/offerPilot/packages/" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
