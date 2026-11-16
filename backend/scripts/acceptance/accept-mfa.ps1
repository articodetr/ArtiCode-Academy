param([string]$BaseUrl = 'http://127.0.0.1:3000', [switch]$AllowRemote)
# MFA (two-step verification) acceptance journey launcher (roadmap 4n, MFA-T05). Asks for the passwords hidden
# (one * per character), builds one JSON object and pipes it on stdin to accept-mfa.mjs (UTF-8, no BOM). Nothing is
# sent before every password is typed; passwords are never stored or printed. Switch the keyboard to English first.
$ErrorActionPreference = 'Stop'
Write-Host '=== MFA (two-step verification) acceptance journey (roadmap 4n, MFA-T05) ==='
Write-Host 'Switch the keyboard to ENGLISH (Alt+Shift) before typing any password.'
Write-Host "API server: $BaseUrl  (change it with -BaseUrl). Start it first: in backend/ run npm run start:dev."
Write-Host 'The server needs AUTH_MFA_ENCRYPTION_KEY (32 bytes, base64) in backend/.env - restart it after adding the key.'
Write-Host 'For each account: press Enter to keep the default e-mail, then type the password (shown as *).'
Write-Host ''
Write-Host 'No phone is needed: the script computes the codes from the secret the server returns. It never prints a'
Write-Host 'password, the secret, a code, a recovery code, a challenge, a token or a cookie.'
Write-Host 'The journey turns two-step verification on and off for the STUDENT account and always leaves it OFF.'
Write-Host 'Every other session of the student ends (a browser signed in as the student is signed out).'
Write-Host 'It types a wrong password once and three wrong codes on purpose (the lock needs 5 failures in 15 minutes).'
Write-Host 'It signs the student in 6 times: before a second run wait 15 minutes, or restart the dev server.'
Write-Host 'It may wait up to 30 seconds a few times for the next code. The admin account must have no MFA.'
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
$student = Read-Account 'STUDENT' 'st@articode.com'

$payload = @{ baseUrl = $BaseUrl; admin = $admin; student = $student; allowRemote = [bool]$AllowRemote }
$json = $payload | ConvertTo-Json -Depth 4 -Compress

Write-Host ''
Write-Host 'Running the journey...'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$json | node "$PSScriptRoot\accept-mfa.mjs"
$code = $LASTEXITCODE

$json = $null; $payload = $null; $admin = $null; $student = $null
exit $code
