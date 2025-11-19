# BATTLE INDEX - 開発環境セットアップ

## 🚀 クイックスタート

### サーバー起動
```bash
# Node.js APIサーバー起動
cd node
npm install
node server.js

# HTTPサーバー起動（別のターミナル）
cd ..
python -m http.server 8080
```

### アクセスURL
- **アプリケーション**: http://localhost:8080/index.html
- **Node.js API**: http://localhost:3001/api/get_ranking

## ⚠️ 開発環境の既知の警告について

### 1. Tailwind CSS CDN警告
**メッセージ**: `cdn.tailwindcss.com should not be used in production`

**対応**: 本プロジェクトは開発・プロトタイプ段階のため、CDN使用は適切です。
本番デプロイ時には以下で解決：
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### 2. Chrome拡張機能エラー
**メッセージ**: `chrome-extension://... net::ERR_FILE_NOT_FOUND`

**対応**: ブラウザ拡張機能の問題で、アプリ動作には影響なし。
エラー抑制システムにより、コンソールからは除外されます。

### 3. LocalStorage警告
**メッセージ**: `QuotaExceededError` または `Storage quota exceeded`

**対応**: エラーハンドリングを追加済み。サーバーAPI優先、
LocalStorageはフォールバック用として使用。

## 🛠️ 本番環境デプロイ準備

### Tailwind CSS最適化
1. PostCSSセットアップ
2. 不要なクラスのPurge設定
3. 最小化されたCSSビルド

### サーバー設定
- Node.js APIサーバーの本番用設定
- 静的ファイル配信の最適化
- HTTPS対応

## 📁 プロジェクト構造

```
DEMOhi/
├── index.html          # メインHTML
├── script.js           # フロントエンドロジック
├── style.css           # カスタムスタイル
├── node/               # Node.jsサーバー
│   ├── server.js       # Express + WebSocket
│   ├── package.json    # 依存関係
│   └── data/           # JSONデータベース
├── src/                # 保存された画像
└── start_servers.bat   # 簡単起動スクリプト
```

## 🔧 開発時のトラブルシューティング

### ポート競合
- Node.js API: 3001
- HTTP Server: 8080
- WebSocket: 8765

### データベース
JSONファイルベース（`node/data/`フォルダ）:
- `ranking.json`: ランキングデータ
- `battle_results.json`: バトル結果

### デバッグモード
ブラウザコンソールで：
```javascript
window._debugMode = true; // デバッグログ有効化
```