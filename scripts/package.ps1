<#
Builds a single standalone .exe with everything embedded (login page,
dashboard, styles, Google OAuth client, and whatever's currently in
server\data) — nothing else needs to be shipped alongside it. Run from the
project root:

    powershell -ExecutionPolicy Bypass -File scripts\package.ps1

Before running this for the first time, set a login password for each role:

    deno task set-password wetlab <password>
    deno task set-password coordinator <password>
    deno task set-password manager <password>

Those are stored as salted hashes in server\data\auth-config.json (not
plaintext) and get baked into the exe, since login is required.

Whatever is currently in server\data\token.json / failure-sheet-config.json
also gets baked in as a one-time seed: on first run on another PC, the exe
copies them into that PC's own %APPDATA%\CultureFailureMonitor\ (writable,
since the token needs to be refreshable) so everyone shares this same
already-connected Google Sheet. If those files are empty/missing at build
time, each recipient goes through their own "Connect now" flow instead.
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path "server\data\auth-config.json")) {
    throw "No login passwords set up yet. Run 'deno task set-password <wetlab|coordinator|manager> <password>' for each role first."
}

Write-Host "Compiling exe (embedding public/, server/views, server/credentials, server/data)..."
deno task build
if ($LASTEXITCODE -ne 0) { throw "deno task build failed" }

$exe = Join-Path $root "dist\culture-failure-monitor.exe"
$sizeMB = [Math]::Round((Get-Item $exe).Length / 1MB, 1)

Write-Host ""
Write-Host "Ready: $exe ($sizeMB MB)"
Write-Host "This single file is the whole app. Share just this .exe (e.g. via a zip if your transfer method needs one) - no other folders needed."
Write-Host "The other person double-clicks it (no console window appears) and it opens the login page in their browser automatically."
