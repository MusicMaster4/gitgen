@echo off
REM gg — short alias for gitgen (Git Command Generator)
REM Dev-only launcher for this clone. Prefer: npm install -g git-command-generator
REM (puts gg/gitgen/git-gen on the npm global PATH).
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
