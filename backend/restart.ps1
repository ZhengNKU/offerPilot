# 1) 列出并 kill 所有跑 uvicorn 的 python 进程
$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'uvicorn|app\.main' }

foreach ($p in $procs) {
    Write-Host "kill pid=$($p.ProcessId) cmd=$($p.CommandLine)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# 2) 等端口释放
$tries = 0
while ($tries -lt 10) {
    $owners = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
    if (-not $owners) { break }
    Start-Sleep -Milliseconds 500
    $tries++
}

$owners = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
if ($owners) {
    Write-Host "port-8001-still-listening:$($owners.OwningProcess -join ',')"
} else {
    Write-Host "port-8001-free"
}
