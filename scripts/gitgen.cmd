@echo off
REM gitgen — Git Command Generator
REM   gitgen start              -> abre o app no navegador (sobe o server se preciso)
REM   gitgen <comando> [args]   -> roda o workflow no terminal
REM   gitgen / gitgen help      -> lista de comandos
REM
REM Comandos longos e curtos (também via gg / git-gen):
REM   start · commit|c [push|p] · branch|b · merge|m · save|s · switch|sw · remote|r · restore|rs · help|h
setlocal
set "GCG_TTY=1"
bun "%~dp0cli.ts" %*
exit /b %errorlevel%
