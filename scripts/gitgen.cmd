@echo off
REM gitgen — abre o Git Command Generator com a pasta atual (cwd)
REM   gitgen              -> abre no navegador (sobe o server se preciso)
REM   gitgen commit       -> add tudo, gera mensagem por IA e commita
REM   gitgen commit push  -> add tudo, gera mensagem, commita e da push
setlocal
set "PORT=%GCG_PORT%"
if "%PORT%"=="" set "PORT=2001"

if /i "%~1"=="commit" (
  bun "%~dp0commit.ts" %*
  exit /b %errorlevel%
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-here.ps1" -Port "%PORT%"
