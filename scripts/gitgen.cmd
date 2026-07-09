@echo off
REM gitgen — Git Command Generator (Node CLI)
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
