# Installs Moonproject-Setup.exe on a clean Windows machine (the CI runner), checks the service, the "Join this PC"
# page and HTTPS trusted through the shop CA the way a PC joins, then updates in place (a checked copy of the database
# first), tries an update to a build that cannot start (it must go back by itself), and uninstalls, keeping the data.
$ErrorActionPreference = 'Stop'
$setup = Join-Path $PSScriptRoot 'out\Moonproject-Setup.exe'
$broken = Join-Path $PSScriptRoot 'out\Moonproject-Setup-broken.exe'
$data = Join-Path $env:ProgramData 'Moonproject'
$program = Join-Path $env:ProgramFiles 'Moonproject'
$version = $env:MOONPROJECT_VERSION

function Install([string]$exe, [string]$log, [string[]]$more = @()) {
  $p = Start-Process $exe -ArgumentList (@('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TASKS=""', "/LOG=$log") + $more) -Wait -PassThru
  if ($p.ExitCode -ne 0) { Get-Content $log -Tail 40; throw "Setup exited with $($p.ExitCode)" }
}

function LastUpdate([string]$expected) {
  Get-Content (Join-Path $data 'logs\update.log') -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  $u = Get-Content (Join-Path $data 'update\last-update.json') -Raw | ConvertFrom-Json
  if ($u.result -ne $expected) { throw "The update ended $($u.result), not ${expected}: $($u.message)" }
  return $u
}

function WaitForHealth([string]$url) {
  for ($i = 0; $i -lt 60; $i++) {
    try { $h = Invoke-RestMethod $url -TimeoutSec 5; if ($h.ok) { return $h } } catch { }
    Start-Sleep -Seconds 2
  }
  throw "No answer from $url"
}

function WaitForService {
  for ($i = 0; $i -lt 30; $i++) {
    $s = Get-Service 'Moonproject' -ErrorAction SilentlyContinue
    if ($s -and $s.Status -eq 'Running' -and (Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Seconds 2
  }
  throw "The service is not serving on port 443 (status: $($s.Status))"
}

# Anything already on the ports would answer instead of Moonproject.
Get-NetTCPConnection -State Listen -LocalPort 80, 443 -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host "Before install, port $($_.LocalPort) is used by $((Get-Process -Id $_.OwningProcess).ProcessName)" }

Install $setup 'setup-1.log'
$svc = Get-CimInstance Win32_Service -Filter "Name='Moonproject'"
if (-not $svc) { throw 'The service is not installed' }
Write-Host "Service $($svc.State), start mode $($svc.StartMode), account $($svc.StartName)"
if ($svc.StartName -ne 'NT SERVICE\Moonproject') { throw "The service runs as $($svc.StartName)" }
WaitForService

# A PC joins: the page over HTTP (port 80, or 8080 when another program has 80, as on the CI machine), the CA
# download, then HTTPS with only the shop CA trusted.
$joinPort = $null
for ($i = 0; $i -lt 30 -and -not $joinPort; $i++) {
  if ((Get-Content (Join-Path $data 'logs\moonproject-service.out.log') -Raw -ErrorAction SilentlyContinue) -match 'page on port (\d+)') { $joinPort = $Matches[1] } else { Start-Sleep -Seconds 2 }
}
if (-not $joinPort) { throw 'The "Join this PC" page did not start' }
Write-Host "Join page on port $joinPort"
$page = Invoke-WebRequest "http://127.0.0.1:$joinPort/" -MaximumRedirection 0
if ([string]$page.Content -notmatch 'Join this PC to Moonproject') { throw "The join page is wrong: $($page.StatusCode)" }
Invoke-WebRequest "http://127.0.0.1:$joinPort/moonproject-ca.crt" -MaximumRedirection 0 -OutFile 'ca.crt'
$ca = Import-Certificate -FilePath 'ca.crt' -CertStoreLocation 'Cert:\LocalMachine\Root'
Write-Host "Shop CA $($ca.Thumbprint) trusted"
$h = WaitForHealth 'https://localhost/api/health'
Write-Host "HTTPS by name: $($h.serverTime), version $($h.version)"
if ($h.version -ne $version) { throw "The server says it is $($h.version), not $version" }
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)' } | Select-Object -First 1).IPAddress
if ($ip) { WaitForHealth "https://$ip/api/health" | Out-Null; Write-Host "HTTPS by address $ip" }
# Practice mode: a made-up shop on port 8443 with its own database; the first start makes its data.
$p = WaitForHealth 'https://localhost:8443/api/health'
if (-not $p.practice) { throw 'Port 8443 is not the practice shop' }
if (-not (Test-Path (Join-Path $data 'data\practice\practice.db'))) { throw 'The practice database is not in ProgramData\Moonproject\data\practice' }
Write-Host 'Practice shop on port 8443'

if (-not (Test-Path (Join-Path $data 'data\moonproject.db'))) { throw 'The database is not in ProgramData\Moonproject\data' }
$who = (Get-Acl (Join-Path $data 'data')).Access | ForEach-Object { $_.IdentityReference.Value }
Write-Host "Data folder access: $($who -join ', ')"
if ($who -match 'Users|Everyone') { throw 'The data folder is open to ordinary users' }

# An update in place: a checked copy of the database first, the program moved aside, and the service back on the same
# database and CA.
Install $setup 'setup-2.log'
WaitForService
WaitForHealth 'https://localhost/api/health' | Out-Null
$u = LastUpdate 'updated'
if (-not (Test-Path $u.copy)) { throw "The copy from before the update is missing: $($u.copy)" }
if (-not (Test-Path (Join-Path $program 'previous\app\apps\server\src\main.ts'))) { throw 'The previous program was not kept' }
Write-Host "Updated in place; the database was copied to $($u.copy)"
if (-not (WaitForHealth 'https://localhost:8443/api/health').practice) { throw 'The practice shop did not come back after the update' }

# An update to a build that cannot start: Setup puts the previous program and the database back by itself.
Install $broken 'setup-3.log' @('/HEALTHWAIT=45')
WaitForService
$h = WaitForHealth 'https://localhost/api/health'
if ($h.version -ne $version) { throw "After the failed update the server says it is $($h.version), not $version" }
$u = LastUpdate 'rolled-back'
Write-Host "The broken update went back by itself: $($u.message)"

# Uninstall keeps the data.
$p = Start-Process (Join-Path $program 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Uninstall exited with $($p.ExitCode)" }
if (Get-Service 'Moonproject' -ErrorAction SilentlyContinue) { throw 'The service is still there after uninstall' }
if (-not (Test-Path (Join-Path $data 'data\moonproject.db'))) { throw 'Uninstall removed the database' }
if (Test-Path (Join-Path $program 'previous')) { throw 'Uninstall left the previous program behind' }
Remove-Item -Path "Cert:\LocalMachine\Root\$($ca.Thumbprint)"
Write-Host 'Smoke test passed'
