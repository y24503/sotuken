@echo off
title BATTLE INDEX Server Starter
echo ===============================================
echo    BATTLE INDEX - 開発サーバー起動スクリプト
echo ===============================================
echo.

echo [1/2] Node.js APIサーバーを起動中...
cd /d "c:\Users\y24517\Documents\GitHub\sotuken\sotuken\DEMOhi\node"
start "Node.js API Server" cmd /k "echo Node.js APIサーバー (ポート 3001, WebSocket 8765) && node server.js"

timeout /t 2 >nul

echo [2/2] HTTPサーバーを起動中...
cd /d "c:\Users\y24517\Documents\GitHub\sotuken\sotuken\DEMOhi"
start "HTTP Server" cmd /k "echo HTMLファイル提供サーバー (ポート 8080) && python -m http.server 8080"

timeout /t 3 >nul

echo.
echo ✅ サーバー起動完了！
echo.
echo 📱 アクセスURL:
echo   - メインアプリ: http://localhost:8080/index.html
echo   - Node.js API:  http://localhost:3001/api/get_ranking
echo.
echo 🛠️  デバッグモード有効化:
echo   ブラウザコンソールで: window._debugMode = true
echo.
echo 🔧 各サーバーウィンドウを閉じてサーバーを停止できます。
echo.
echo ⚠️  開発環境用設定です。本番デプロイ前にREADME_DEV.mdを参照してください。
echo.
pause