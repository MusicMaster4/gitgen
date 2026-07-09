@echo off
cd /d "%~dp0"

start "Git Command Generator - Server" cmd /k bun run dev

timeout /t 2 /nobreak >nul

REM Abre sem ?path= → o app mostra o modal de pastas recentes / colar caminho
start chrome http://localhost:2001