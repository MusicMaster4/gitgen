@echo off
REM gg — short alias for gitgen (Git Command Generator)
REM   gg start              -> open the app in the browser (starts server if needed)
REM   gg <cmd> [args]       -> run a workflow in the terminal
REM   gg / gg h             -> help
REM
REM Short commands (long form also works via gitgen / git-gen):
REM   gg start      open app with current folder
REM   gg c          commit
REM   gg c p        commit + push
REM   gg b <name>   create branch
REM   gg m <src>    merge into main (or gg m <src> <dst>)
REM   gg s          save & return to main
REM   gg sw <name>  switch branch
REM   gg r <url>    add remote + first push
REM   gg rs [file]  restore (destructive)
REM   gg h          help
setlocal
set "GCG_TTY=1"
bun "%~dp0cli.ts" %*
exit /b %errorlevel%
