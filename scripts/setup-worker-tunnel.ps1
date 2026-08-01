param(
  [string]$VercelToken = $env:VERCEL_TOKEN
)

$ErrorActionPreference = "Stop"
$composeDir = Join-Path $PSScriptRoot "..\workers\track-analysis"

Write-Host ":: Starting analysis worker and Cloudflare quick tunnel..."
Set-Location $composeDir
docker compose up -d --wait

Write-Host ":: Waiting for cloudflared to report tunnel URL..."
$url = $null
for ($i = 0; $i -lt 30; $i++) {
  $logs = docker compose logs cloudflared 2>$null
  $match = [regex]::Match($logs, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($match.Success) {
    $url = $match.Value
    break
  }
  Start-Sleep -Seconds 2
}

if (-not $url) {
  Write-Error "Could not detect tunnel URL from cloudflared logs.`nCheck 'docker compose logs cloudflared' manually."
  exit 1
}

Write-Host ":: Tunnel URL: $url"

if ($VercelToken) {
  Write-Host ":: Updating Vercel environment variable ANALYSIS_WORKER_URL..."
  $url | npx vercel env add ANALYSIS_WORKER_URL production --token $VercelToken --yes 2>$null
  if (-not $?) {
    Write-Warning "Vercel env update failed. Set manually:"
  }
} else {
  Write-Host "`n  Set it manually:"
  Write-Host "`n    echo '$url' | npx vercel env add ANALYSIS_WORKER_URL production`n"
}

Write-Host ":: Done. Worker reachable at $url"