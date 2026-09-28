# Installs Moonproject-Setup.exe on a clean Windows machine (the CI runner), checks the service, the "Join this PC"
# page and HTTPS trusted through the shop CA the way a PC joins, then updates in place and uninstalls, keeping the data.
$ErrorActionPreference = 'Stop'
$setup = Join-Path $PSScriptRoot 'out\Moonproject-Setup.exe'
$data = Join-Path $env:ProgramData 'Moonproject'

function Install([string]$log) {
  $p = Start-Process $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TASKS=""', "/LOG=$log" -Wait -PassThru
  if ($p.ExitCode -ne 0) { Get-Content $log -Tail 40; throw "Setup exited with $($p.ExitCode)" }
}

function WaitForHealth([string]$url) {
  for ($i = 0; $i -lt 60; $i++) {
    try { $h = Invoke-RestMethod $url -TimeoutSec 5; if ($h.ok) { return $h } } catch { }
    Start-Sleep -Seconds 2
  }
  throw "No answer from $url"
}

Install 'setup-1.log'
$svc = Get-CimInstance Win32_Service -Filter "Name='Moonproject'"
if (-not $svc) { throw 'The service is not installed' }
Write-Host "Service $($svc.State), start mode $($svc.StartMode), account $($svc.StartName)"
if ($svc.StartName -ne 'NT SERVICE\Moonproject') { throw "The service runs as $($svc.StartName)" }

# A PC joins: the page over HTTP, the CA download, then HTTPS with only the shop CA trusted.
for ($i = 0; $i -lt 60; $i++) { try { if ((Invoke-WebRequest 'http://localhost/' -TimeoutSec 5).StatusCode -eq 200) { break } } catch { Start-Sleep -Seconds 2 } }
$page = (Invoke-WebRequest 'http://localhost/').Content
if ($page -notmatch 'Join this PC to Moonproject') { throw 'The join page is wrong' }
Invoke-WebRequest 'http://localhost/moonproject-ca.crt' -OutFile 'ca.crt'
$ca = Import-Certificate -FilePath 'ca.crt' -CertStoreLocation 'Cert:\LocalMachine\Root'
Write-Host "Shop CA $($ca.Thumbprint) trusted"
$h = WaitForHealth 'https://localhost/api/health'
Write-Host "HTTPS by name: $($h.serverTime)"
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)' } | Select-Object -First 1).IPAddress
if ($ip) { WaitForHealth "https://$ip/api/health" | Out-Null; Write-Host "HTTPS by address $ip" }

if (-not (Test-Path (Join-Path $data 'data\moonproject.db'))) { throw 'The database is not in ProgramData\Moonproject\data' }
$who = (Get-Acl (Join-Path $data 'data')).Access | ForEach-Object { $_.IdentityReference.Value }
Write-Host "Data folder access: $($who -join ', ')"
if ($who -match 'Users|Everyone') { throw 'The data folder is open to ordinary users' }

# An update in place: the service comes back on the same database and CA.
Install 'setup-2.log'
WaitForHealth 'https://localhost/api/health' | Out-Null
Write-Host 'Updated in place'

# Uninstall keeps the data.
$p = Start-Process (Join-Path $env:ProgramFiles 'Moonproject\unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Uninstall exited with $($p.ExitCode)" }
if (Get-Service 'Moonproject' -ErrorAction SilentlyContinue) { throw 'The service is still there after uninstall' }
if (-not (Test-Path (Join-Path $data 'data\moonproject.db'))) { throw 'Uninstall removed the database' }
Remove-Item -Path "Cert:\LocalMachine\Root\$($ca.Thumbprint)"
Write-Host 'Smoke test passed'
