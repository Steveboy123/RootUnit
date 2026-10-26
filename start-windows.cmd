@echo off
rem RootUnit on Windows: double-click to run the real app (real Spotify, TIDAL, YouTube Music and radio) at http://127.0.0.1:8787
rem The first run installs and builds, which takes a few minutes. "start-windows.cmd rebuild" installs anything new and builds again after an update.
rem Close this window (or press Ctrl+C) to stop RootUnit. Guide: docs\windows.md
setlocal
rem A computer-wide NODE_ENV=production would skip the build tools and open the Pi's kiosk mode after a sign-in.
set "NODE_ENV="
cd /d "%~dp0"
title RootUnit

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Install the LTS version from https://nodejs.org ^(tick "Add to PATH"^),
  echo then double-click this file again.
  echo.
  pause
  exit /b 1
)
for /f "tokens=1,2 delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a" & set "NODE_MINOR=%%b"
set "NODE_OK=1"
if %NODE_MAJOR% LSS 22 set "NODE_OK="
if %NODE_MAJOR% EQU 22 if %NODE_MINOR% LSS 9 set "NODE_OK="
if not defined NODE_OK (
  echo.
  echo RootUnit needs Node.js 22.9 or newer. This computer has:
  node -v
  echo Install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

rem Install when it never finished, when the build tools are missing (npm set to skip developer tools, or an install that was
rem stopped part-way) and on "rebuild". --include=dev keeps TypeScript and Vite even when NODE_ENV=production or omit=dev is set.
set "INSTALL="
set "BUILD="
if /i "%~1"=="rebuild" set "INSTALL=1"
if not exist "node_modules\.package-lock.json" set "INSTALL=1"
if not exist "node_modules\.bin\tsc.cmd" set "INSTALL=1"
if not exist "node_modules\.bin\vite.cmd" set "INSTALL=1"
if defined INSTALL (
  echo Installing RootUnit's parts. This takes a few minutes the first time...
  call npm install --include=dev --no-audit --no-fund
  if errorlevel 1 goto failed
  if not exist "node_modules\.bin\tsc.cmd" goto notools
  if not exist "node_modules\.bin\vite.cmd" goto notools
  set "BUILD=1"
)
if not exist "apps\ui\dist\index.html" set "BUILD=1"
if not exist "apps\server\dist\index.js" set "BUILD=1"
if defined BUILD (
  echo Building RootUnit...
  call npm run build
  if errorlevel 1 goto failed
)

echo.
echo RootUnit is starting at http://127.0.0.1:8787  ^(close this window to stop it^)
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:8787/?frame"
call npm start
goto :eof

:notools
echo.
echo The install finished without RootUnit's build tools ^(TypeScript and Vite^).
echo Delete the node_modules folder next to this file, then double-click this file again.
echo.
pause
exit /b 1

:failed
echo.
echo Something went wrong above. Check the messages, then try again. docs\windows.md has a troubleshooting list.
echo.
pause
exit /b 1
