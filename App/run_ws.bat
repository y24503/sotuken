@echo off
setlocal
set "SCRIPTPATH=%~dp0"
set "SERVER=%SCRIPTPATH%server.py"

echo Starting JSOK WS server (Python)...

:: Try with py launcher
where py >nul 2>nul
if %errorlevel%==0 (
  start "JSOK WS (py)" cmd /c py -3 "%SERVER%"
  goto :end
)

:: Fallback to python in PATH
where python >nul 2>nul
if %errorlevel%==0 (
  start "JSOK WS (python)" cmd /c python "%SERVER%"
  goto :end
)

echo Python が見つかりません。Python 3.x をインストールして PATH に追加してください。
pause

:end
endlocal
