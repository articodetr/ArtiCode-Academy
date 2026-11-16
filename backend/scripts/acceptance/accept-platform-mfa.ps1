param(
  [string]$PlatformUrl = '',
  [int]$PlatformPort = 3100,
  [switch]$AllowRemote
)
# Platform MFA (two-step verification of platform accounts) acceptance journey launcher (roadmap 4o, PMFA-T05).
# Asks for NO password: the journey creates its own throwaway platform account (role support) with
# npm run platform:create-user and a random password it never prints. Builds one JSON object (no secret in it) and
# pipes it on stdin to accept-platform-mfa.mjs (UTF-8, no BOM).
#
# The script starts the PLATFORM API itself from backend/dist/platform/main.js on 127.0.0.1:<PlatformPort> and stops
# it at the end - unless -PlatformUrl names a platform API that already runs. The academy API is not needed.
$ErrorActionPreference = 'Stop'
Write-Host '=== Platform MFA (two-step verification) acceptance journey (roadmap 4o, PMFA-T05) ==='
Write-Host 'No password is asked: the journey creates a throwaway platform account acc-pmfa-<yyMMddHHmm>@example.test'
Write-Host '(role support) with npm run platform:create-user and a random 20-character password it never prints.'
Write-Host 'The account row and its platform audit events stay in the dev platform database as evidence.'
if ([string]::IsNullOrWhiteSpace($PlatformUrl)) {
  Write-Host "Platform API: started by this script on http://127.0.0.1:$PlatformPort from backend/dist/platform/main.js, stopped at the end."
  Write-Host 'Compile it first if needed: in backend/ run npm run start:dev (it compiles the platform too) or npx nest build.'
  Write-Host 'PLATFORM_MFA_ENCRYPTION_KEY: taken from your environment or backend/.env when set there, else a throwaway'
  Write-Host 'key is generated for that platform process only (never printed or stored).'
} else {
  Write-Host "Platform API: $PlatformUrl (already running). It needs PLATFORM_MFA_ENCRYPTION_KEY and must use the platform"
  Write-Host 'database of backend/.env - the create-user and reset-mfa commands write there.'
}
Write-Host 'Before the journey: in backend/ run npm run platform:deploy once (the PMFA migration).'
Write-Host ''
Write-Host 'No phone is needed: the script computes the codes from the secret the server returns. It never prints a'
Write-Host 'password, the key, the secret, a code, a recovery code, a challenge, a token or a cookie.'
Write-Host 'It always leaves the throwaway account WITHOUT MFA (npm run platform:reset-mfa when needed).'
Write-Host 'It may wait up to 30 seconds a few times for the next code. Run it at most once a minute.'
Write-Host ''

$payload = @{
  platformUrl = $(if ([string]::IsNullOrWhiteSpace($PlatformUrl)) { $null } else { $PlatformUrl })
  platformPort = $PlatformPort
  allowRemote = [bool]$AllowRemote
}
$json = $payload | ConvertTo-Json -Depth 3 -Compress

Write-Host 'Running the journey...'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$json | node "$PSScriptRoot\accept-platform-mfa.mjs"
$code = $LASTEXITCODE

$json = $null; $payload = $null
exit $code
