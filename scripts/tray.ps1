# Git Command Generator - tray (bandeja)
#
# Sobe o server (npm run dev) em segundo plano, SEM janela, e coloca um icone
# perto do relogio. Menu do icone: Abrir / Ver logs / Reiniciar / Encerrar.
#
# Instancia unica: se ja houver uma bandeja rodando, este processo sai sozinho.
# Normalmente e lancado pelo tray.vbs (que esconde tudo). Tambem roda direto:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tray.ps1

param(
  [string]$Port = $(if ($env:GCG_PORT) { $env:GCG_PORT } else { "2001" })
)

$ErrorActionPreference = "Stop"
$portNum = [int]$Port
$repoRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $repoRoot "terminals\server.log"
$baseUrl = "http://localhost:$Port/"

# --- instancia unica (por porta) ---
$mutexName = "Global\GitCommandGeneratorTray_$Port"
$createdNew = $false
$script:mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# --- helpers ---
function Test-ServerReady([int]$p) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(300, $false)
    if (-not $ok) { $client.Close(); return $false }
    $client.EndConnect($iar); $client.Close(); return $true
  } catch { return $false }
}

# Mata quem estiver escutando na porta (arvore de processos).
function Stop-ServerOnPort([int]$p) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
      cmd /c "taskkill /PID $($c.OwningProcess) /T /F" > $null 2>&1
    }
  } catch {}
}

# Sobe o npm run dev escondido, com log combinado. Devolve o Process (cmd host).
function Start-Server {
  if (Test-ServerReady $portNum) { return $null }  # ja de pe: nao sobe outro
  New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
  $cmdLine = 'cd /d "' + $repoRoot + '" && npm run dev > "' + $logPath + '" 2>&1'
  return Start-Process cmd.exe -ArgumentList '/c', $cmdLine -WindowStyle Hidden -PassThru
}

$script:serverProc = Start-Server

# --- icone ---
function Get-TrayIcon {
  $ico = Join-Path $repoRoot "app\favicon.ico"
  if (Test-Path $ico) {
    try { return New-Object System.Drawing.Icon ($ico, 16, 16) } catch {}
  }
  # fallback: desenha um circulo laranja com "G"
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 80, 34))
  $g.FillEllipse($brush, 1, 1, 30, 30)
  $font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $rect = New-Object System.Drawing.RectangleF 0, 0, 32, 32
  $g.DrawString('G', $font, [System.Drawing.Brushes]::White, $rect, $sf)
  $g.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = Get-TrayIcon
$notify.Text = "Git Command Generator (:$Port)"
$notify.Visible = $true

# --- menu ---
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miOpen = $menu.Items.Add("Abrir no navegador")
$miOpen.add_Click({ Start-Process $baseUrl })

$miLogs = $menu.Items.Add("Ver logs")
$miLogs.add_Click({
  if (Test-Path $logPath) { Start-Process notepad.exe $logPath }
})

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$miRestart = $menu.Items.Add("Reiniciar server")
$miRestart.add_Click({
  Stop-ServerOnPort $portNum
  Start-Sleep -Milliseconds 800
  $script:serverProc = Start-Server
  $notify.ShowBalloonTip(2000, "Git Command Generator", "Server reiniciado.", [System.Windows.Forms.ToolTipIcon]::Info)
})

$miQuit = $menu.Items.Add("Encerrar server")
$miQuit.add_Click({
  Stop-ServerOnPort $portNum
  $notify.Visible = $false
  $notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu
$notify.add_MouseDoubleClick({ Start-Process $baseUrl })

# --- loop de mensagens (segura o processo vivo) ---
[System.Windows.Forms.Application]::Run()
