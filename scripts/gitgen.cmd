@echo off
REM gitgen — abre o Git Command Generator com a pasta atual (cwd)
REM Se o server estiver offline, sobe em uma nova janela CMD.
setlocal
set "PORT=%GCG_PORT%"
if "%PORT%"=="" set "PORT=2001"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-here.ps1" -Port "%PORT%"
