@echo off
cd /d "%~dp0"

REM Sobe o server em segundo plano (icone na bandeja, sem janela flutuante).
start "" wscript.exe "%~dp0scripts\tray.vbs"

timeout /t 3 /nobreak >nul

REM Abre sem ?path= -> o app mostra o modal de pastas recentes / colar caminho
start chrome http://localhost:2001
