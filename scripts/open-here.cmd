@echo off
setlocal
set "PORT=%GCG_PORT%"
if "%PORT%"=="" set "PORT=2001"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-here.ps1" -Port "%PORT%"
