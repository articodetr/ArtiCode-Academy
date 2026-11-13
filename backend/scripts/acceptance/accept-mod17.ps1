param([int]$Port = 8080, [switch]$Keep, [switch]$NoBuild)
# MOD-17 acceptance journey launcher (roadmap 4l.9). Brings up a throwaway academy `academy-demo` on
# http://localhost:<Port> with Docker Desktop, signs in as its first admin, takes a backup, runs the restore
# drill, then takes the whole demo academy down again (its containers and volumes only).
# Asks for the demo admin's password hidden (one * per character), builds one JSON object and pipes it on
# stdin to accept-mod17.mjs (UTF-8, no BOM). The password is never stored or printed. Switch the keyboard
# to English first. Docker Desktop must be running. The demo admin exists only inside the demo academy.
$ErrorActionPreference = 'Stop'
Write-Host '=== MOD-17 acceptance journey (roadmap 4l.9) ==='
Write-Host 'Switch the keyboard to ENGLISH (Alt+Shift) before typing any password.'
Write-Host "Demo academy: http://localhost:$Port  (change it with -Port; -Keep leaves it running; -NoBuild reuses the images)."
Write-Host 'The first build takes several minutes. Nothing touches your development database.'
Write-Host ''

$email = Read-Host 'Demo admin e-mail (Enter = admin@demo.local)'
if ([string]::IsNullOrWhiteSpace($email)) { $email = 'admin@demo.local' }
$secure = Read-Host 'Choose a password for the demo admin, 12+ characters (hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($plain.Length -lt 12) { Write-Host '  fewer than 12 characters - aborting before anything starts'; exit 2 }
Write-Host "  received $($plain.Length) characters"

$payload = @{ port = $Port; keep = [bool]$Keep; noBuild = [bool]$NoBuild; admin = @{ email = $email; password = $plain } }
$json = $payload | ConvertTo-Json -Depth 4 -Compress

$dockerBin = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
if ((-not (Get-Command docker -ErrorAction SilentlyContinue)) -and (Test-Path $dockerBin)) { $env:PATH = "$dockerBin;$env:PATH" }

Write-Host ''
Write-Host 'Running the journey...'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$json | node "$PSScriptRoot\accept-mod17.mjs"
$code = $LASTEXITCODE

$json = $null; $payload = $null; $plain = $null
exit $code
