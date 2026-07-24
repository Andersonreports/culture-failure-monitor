<#
Builds the standalone Culture Failure Dashboard into a single double-click
.exe. Everything (the HTML page, its JS/CSS, and the background image) is
embedded — nothing else ships alongside it. Run from the project root:

    powershell -ExecutionPolicy Bypass -File scripts\package-standalone.ps1

The exe is a tiny local static server: double-clicking it serves the dashboard
on http://localhost and opens the browser (no console window). The dashboard
talks directly to your Google Apps Script web app, so BEFORE building you must
set APPS_SCRIPT_URL in standalone\culture-failure.html to your deployed /exec
URL (see standalone\README.md). This script refuses to build while it's still
the placeholder, so you don't ship a "Not connected" exe by accident.

Requires Deno (https://deno.com) on PATH.
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$html = Join-Path $root "standalone\culture-failure.html"
if (-not (Test-Path $html)) { throw "Cannot find standalone\culture-failure.html" }

if (Select-String -Path $html -Pattern "PASTE_YOUR_WEB_APP_URL_HERE" -Quiet) {
    throw "APPS_SCRIPT_URL is still the placeholder. Set it in standalone\culture-failure.html to your deployed Apps Script /exec URL first (see standalone\README.md)."
}

Write-Host "Compiling exe (embedding the standalone/ folder)..."
deno task build-standalone
if ($LASTEXITCODE -ne 0) { throw "deno task build-standalone failed" }

$exe = Join-Path $root "dist\culture-failure-dashboard.exe"
$sizeMB = [Math]::Round((Get-Item $exe).Length / 1MB, 1)

Write-Host ""
Write-Host "Ready: $exe ($sizeMB MB)"
Write-Host "This single file is the whole app. The recipient double-clicks it (no console window) and it opens the dashboard in their browser."
