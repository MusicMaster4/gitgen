@echo off
REM gg — short alias for gitgen (Git Command Generator)
REM Local PATH: points at built Node CLI (run npm run build:cli after clone).
setlocal
set "GCG_TTY=1"
set "ROOT=%~dp0.."
set "CLI=%ROOT%\dist\cli.js"
if not exist "%CLI%" (
  echo Building CLI ^(npm run build:cli^)...
  pushd "%ROOT%"
  call npm run build:cli
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
)
node "%CLI%" %*
exit /b %errorlevel%
