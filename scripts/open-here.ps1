# Abre o Git Command Generator com a pasta atual (cwd).
# Se o server nao estiver rodando, sobe em uma janela nova de CMD e espera ficar pronto.
#
# Uso:  gitgen
#       .\open-here.ps1
#       .\open-here.ps1 -Port 2001

param(
  [string]$Port = $(if ($env:GCG_PORT) { $env:GCG_PORT } else { "2001" }),
  [int]$TimeoutSec = 90
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cwd = (Get-Location).Path
$encoded = [uri]::EscapeDataString($cwd)
$url = "http://localhost:$Port/?path=$encoded"
$portNum = [int]$Port

function Test-LocalPort([int]$p) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(300, $false)
    if (-not $ok) {
      $client.Close()
      return $false
    }
    $client.EndConnect($iar)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Test-ServerReady([int]$p) {
  if (-not (Test-LocalPort $p)) { return $false }
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$p/" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
    return $true
  } catch {
    # porta aberta mas ainda bootando
    return (Test-LocalPort $p)
  }
}

Write-Host "Git Command Generator"
Write-Host "  projeto : $cwd"
Write-Host "  app    : $repoRoot"
Write-Host "  url    : $url"

if (Test-ServerReady $portNum) {
  Write-Host "  server : ja rodando na porta $Port"
} else {
  Write-Host "  server : offline - abrindo nova janela CMD (bun run dev)..."

  if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
    Write-Error "Nao achei o app em: $repoRoot"
    exit 1
  }

  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bun) {
    Write-Error "bun nao encontrado no PATH. Instale o Bun ou rode o server manualmente."
    exit 1
  }

  # Janela separada com o log do Next (como o start-dev.bat)
  # Usa & do cmd.exe (evita problemas de aspas no PowerShell 5.1)
  $cmdArgs = '/k title Git Command Generator - Server :' + $Port + ' & cd /d "' + $repoRoot + '" & bun run dev'
  Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -WorkingDirectory $repoRoot

  Write-Host "  server : aguardando porta $Port (ate $TimeoutSec s)..."
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if (Test-ServerReady $portNum) {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $ready) {
    Write-Host ""
    Write-Host "  timeout: o server nao respondeu a tempo."
    Write-Host "  confira a janela CMD do server e tente de novo."
    exit 1
  }

  Write-Host "  server : pronto"
}

Write-Host "  abrindo browser..."
Start-Process $url
