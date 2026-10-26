@echo off
rem RootUnit on Windows: double-click to run the real app (real Spotify, TIDAL, YouTube Music and radio) at http://127.0.0.1:8787
rem The first run installs and builds, which takes a few minutes. "start-windows.cmd rebuild" builds again after an update.
rem Close this window (or press Ctrl+C) to stop RootUnit. Guide: docs\windows.md
setlocal
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

if not exist "node_modules\" (
  echo Installing RootUnit's parts. This takes a few minutes the first time...
  call npm install
  if errorlevel 1 goto failed
  set "BUILD=1"
)
if /i "%~1"=="rebuild" set "BUILD=1"
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

:failed
echo.
echo Something went wrong above. Check the messages, then try again. docs\windows.md has a troubleshooting list.
echo.
pause
exit /b 1
