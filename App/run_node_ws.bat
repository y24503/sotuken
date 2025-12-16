@echo off
setlocal
set "NODEDIR=%~dp0node"
if not exist "%NODEDIR%\package.json" (
  echo node\package.json が見つかりません。Demo\node に配置してください。
  pause
  goto :end
)

echo Starting JSOK Node WS server...
start "JSOK Node WS" cmd /c "cd /d "%NODEDIR%" && npm start"

:end
endlocal
