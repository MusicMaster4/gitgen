@echo off
REM gitgen — Git Command Generator
REM   gitgen                    -> abre o app no navegador (sobe o server se preciso)
REM   gitgen <comando> [args]   -> roda o workflow no terminal (commit, branch, merge,
REM                                save, switch, remote, restore, help)
setlocal
set "PORT=%GCG_PORT%"
if "%PORT%"=="" set "PORT=2001"

if not "%~1"=="" (
  bun "%~dp0cli.ts" %*
  exit /b %errorlevel%
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-here.ps1" -Port "%PORT%"
