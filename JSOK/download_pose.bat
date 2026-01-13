@echo off
setlocal

rem スクリプトのあるフォルダに移動
cd /d "%~dp0"

set "POSE_SCRIPT=mediapipe\pose\get_pose.ps1"

rem PowerShell スクリプトの存在チェック
if not exist "%POSE_SCRIPT%" (
  echo [ERROR] "%POSE_SCRIPT%" が見つかりません。
  echo mediapipe/pose フォルダに get_pose.ps1 があるか確認してください。
  pause
  exit /b 1
)

echo ==== Pose モデルのダウンロードを開始します ====
echo このウィンドウは閉じないでください...
echo.

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%POSE_SCRIPT%"

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] pose.js のダウンロードに失敗しました。（ERRORLEVEL=%ERRORLEVEL%）
  echo インターネット接続、プロキシ設定、PowerShell の実行ポリシーを確認してください。
  echo 必要に応じて PowerShell を「管理者として実行」して手動で get_pose.ps1 を実行してください。
  pause
  exit /b 1
)

echo.
echo ==== ダウンロードが完了しました ==== 
echo ブラウザを再読み込みして、最新の pose.js が読み込まれていることを確認してください。
echo 何かキーを押すとこのウィンドウを閉じます。
pause
