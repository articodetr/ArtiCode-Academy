param([string]$BaseUrl = 'http://127.0.0.1:3000', [switch]$AllowRemote)
# MOD-13 acceptance journey launcher (roadmap 4k.9). Asks for the passwords hidden (one * per character),
# builds one JSON object and pipes it on stdin to accept-mod13.mjs (UTF-8, no BOM). Nothing is sent before
# every password is typed; passwords are never stored or printed. Switch the keyboard to English first.
$ErrorActionPreference = 'Stop'
Write-Host '=== MOD-13 acceptance journey (roadmap 4k.9) ==='
Write-Host 'Switch the keyboard to ENGLISH (Alt+Shift) before typing any password.'
Write-Host "API server: $BaseUrl  (change it with -BaseUrl). Start it first: in backend/ run npm run start:dev."
Write-Host 'For each account: press Enter to keep the default e-mail, then type the password (shown as *).'
Write-Host ''

function Read-Account([string]$label, [string]$defaultIdentifier) {
  $id = Read-Host "$label e-mail (Enter = $defaultIdentifier)"
  if ([string]::IsNullOrWhiteSpace($id)) { $id = $defaultIdentifier }
  $secure = Read-Host "$label password (hidden)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ($plain.Length -eq 0) { Write-Host "  no password typed for $label - aborting before any request"; exit 2 }
  Write-Host "  received $($plain.Length) characters"
  return @{ identifier = $id; password = $plain }
}

$admin = Read-Account 'ADMIN' 'admin@articode.com'
$teacher = Read-Account 'TEACHER' 'te@articode.com'
$student = Read-Account 'STUDENT' 'st@articode.com'

$payload = @{ baseUrl = $BaseUrl; admin = $admin; teacher = $teacher; student = $student; allowRemote = [bool]$AllowRemote }
$json = $payload | ConvertTo-Json -Depth 4 -Compress

Write-Host ''
Write-Host 'Running the journey...'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$json | node "$PSScriptRoot\accept-mod13.mjs"
$code = $LASTEXITCODE

$json = $null; $payload = $null; $admin = $null; $teacher = $null; $student = $null
exit $code
