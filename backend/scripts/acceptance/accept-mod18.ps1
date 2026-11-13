param(
  [string]$AcademyUrl = 'http://127.0.0.1:3000',
  [string]$PlatformUrl = '',
  [int]$PlatformPort = 3100,
  [switch]$AllowRemote
)
# MOD-18 acceptance journey launcher (roadmap 4m.8). Asks for the platform super admin's e-mail and password
# (hidden, one * per character), builds one JSON object and pipes it on stdin to accept-mod18.mjs (UTF-8, no BOM).
# Nothing is sent before the password is typed; the password is never stored, printed or put on a command line.
# Switch the keyboard to English first.
#
# The academy API must already run (in backend/ run npm run start:dev). The script starts the PLATFORM API itself
# from backend/dist/platform/main.js on 127.0.0.1:<PlatformPort> and stops it at the end - unless -PlatformUrl names
# a platform API that already runs (then no account is ever created: the super admin must exist).
$ErrorActionPreference = 'Stop'
Write-Host '=== MOD-18 acceptance journey (roadmap 4m.8) ==='
Write-Host 'Switch the keyboard to ENGLISH (Alt+Shift) before typing any password.'
Write-Host "Academy API: $AcademyUrl  (change it with -AcademyUrl). Start it first: in backend/ run npm run start:dev."
if ([string]::IsNullOrWhiteSpace($PlatformUrl)) {
  Write-Host "Platform API: started by this script on http://127.0.0.1:$PlatformPort from backend/dist/platform/main.js, stopped at the end."
  Write-Host 'If no platform super admin exists yet, the account below BECOMES the first one (npm run platform:bootstrap-admin).'
} else {
  Write-Host "Platform API: $PlatformUrl (already running). The account below must already be a platform super admin."
}
Write-Host ''

$email = Read-Host 'Platform super admin e-mail'
if ([string]::IsNullOrWhiteSpace($email)) { Write-Host '  no e-mail typed - aborting before any request'; exit 2 }
$fullName = 'Platform Owner'
if ([string]::IsNullOrWhiteSpace($PlatformUrl)) {
  $typedName = Read-Host 'Full name, used only when the account is created now (Enter = Platform Owner)'
  if (-not [string]::IsNullOrWhiteSpace($typedName)) { $fullName = $typedName }
}

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$plain = Read-Secret 'Password, 12+ characters (hidden)'
if ($plain.Length -lt 12) { Write-Host '  fewer than 12 characters (the platform password policy) - aborting before any request'; exit 2 }
if ([string]::IsNullOrWhiteSpace($PlatformUrl)) {
  $again = Read-Secret 'Repeat the password (hidden)'
  if ($again -ne $plain) { $again = $null; Write-Host '  the two passwords differ - aborting before any request'; exit 2 }
  $again = $null
}
Write-Host "  received $($plain.Length) characters"

$payload = @{
  academyUrl = $AcademyUrl
  platformUrl = $(if ([string]::IsNullOrWhiteSpace($PlatformUrl)) { $null } else { $PlatformUrl })
  platformPort = $PlatformPort
  allowRemote = [bool]$AllowRemote
  superAdmin = @{ email = $email.Trim(); fullName = $fullName.Trim(); password = $plain }
}
$json = $payload | ConvertTo-Json -Depth 4 -Compress

Write-Host ''
Write-Host 'Running the journey...'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$json | node "$PSScriptRoot\accept-mod18.mjs"
$code = $LASTEXITCODE

$json = $null; $payload = $null; $plain = $null
exit $code
