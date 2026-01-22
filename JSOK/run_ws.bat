@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
title Demo Node Server
echo === Demo Node server start ===
echo Script dir: %SCRIPT_DIR%

where node >nul 2>nul
if errorlevel 1 (
	echo [ERROR] Node.js が見つかりません。 https://nodejs.org/ からインストールし、PATHを設定してください。
	endlocal
	pause
	exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
	echo [ERROR] npm が見つかりません。Node.js のインストールと PATH 設定を確認してください。
	endlocal
	pause
	exit /b 1
)

if not exist "%SCRIPT_DIR%node" goto NO_NODE_DIR
cd /d "%SCRIPT_DIR%node"

if not exist "node_modules" goto INSTALL_DEPS
goto AFTER_INSTALL

:INSTALL_DEPS
echo Installing dependencies (npm install)...
call npm install
if errorlevel 1 goto NPM_FAIL

:AFTER_INSTALL

set "APP_PORT=%~1"
if "%APP_PORT%"=="" set "APP_PORT=8888"
echo Using port %APP_PORT%

echo Ensuring port %APP_PORT% is free...
powershell -NoLogo -NoProfile -Command "Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force } catch {} }" >nul 2>&1
timeout /t 1 >nul

if /I "%~2"=="bg" goto START_BG
goto START_FG

:START_BG
echo Starting server in a new window (background)...
start "Demo Node Server" cmd /c set PORT=%APP_PORT% ^& node server.js
echo Launched. Visit http://localhost:%APP_PORT%/ (or your LAN IP) and /api/health
echo Opening browser to http://localhost:%APP_PORT%/ ...
start "" "http://localhost:%APP_PORT%/"
endlocal
goto :eof

:START_FG
echo Starting server in current window (Ctrl+C to stop)...
set PORT=%APP_PORT%
echo Opening browser to http://localhost:%APP_PORT%/ ...
start "" "http://localhost:%APP_PORT%/"
node server.js
set EXITCODE=%ERRORLEVEL%
echo Node exited with code %EXITCODE%.
endlocal
pause
goto :eof

:NO_NODE_DIR
echo [ERROR] node folder not found at "%SCRIPT_DIR%node".
endlocal
pause
exit /b 1

:NPM_FAIL
echo [ERROR] npm install failed.
endlocal
pause
exit /b 1
