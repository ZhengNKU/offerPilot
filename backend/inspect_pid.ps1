$pid_to_check = 55056
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$pid_to_check"
if ($p) {
    Write-Host "name=$($p.Name)"
    Write-Host "cmd=$($p.CommandLine)"
    Write-Host "parent=$($p.ParentProcessId)"
    Stop-Process -Id $pid_to_check -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    $still = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
    if ($still) {
        Write-Host "STILL:$($still.OwningProcess -join ',')"
    } else {
        Write-Host "FREE"
    }
} else {
    Write-Host "pid-not-found"
    $owners = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
    Write-Host "owners=$($owners.OwningProcess -join ',')"
}
