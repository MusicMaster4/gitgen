@echo off
REM git-gen — alias de gitgen / gg
REM   git-gen start             -> abre o app (pasta atual)
REM   git-gen <comando> [args]  -> workflow no terminal
REM   git-gen / git-gen help     -> lista de comandos
REM Comandos: start · commit|c [push|p] · branch|b · merge|m · save|s · switch|sw · remote|r · restore|rs · help|h
setlocal
set "GCG_TTY=1"
bun "%~dp0cli.ts" %*
exit /b %errorlevel%
