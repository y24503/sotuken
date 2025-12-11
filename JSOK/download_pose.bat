@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File ".\mediapipe\pose\get_pose.ps1"
if %ERRORLEVEL% NEQ 0 (
  echo Failed to download pose.js. Please check your internet connection or run PowerShell as needed.
  pause
  exit /b 1
)
echo Download completed. Reload your browser page.
pause
