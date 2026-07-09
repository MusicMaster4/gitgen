@echo off
REM git-gen — alias de gitgen (abre o app, ou roda um comando no terminal)
setlocal
set "PORT=%GCG_PORT%"
if "%PORT%"=="" set "PORT=2001"

if not "%~1"=="" (
  bun "%~dp0cli.ts" %*
  exit /b %errorlevel%
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-here.ps1" -Port "%PORT%"
