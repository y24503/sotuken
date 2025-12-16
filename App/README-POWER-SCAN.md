# JSOK (PHP + MediaPipe JS - サーバーレス)

このデモは PHP でフロントとランキングAPIを配信し、映像解析はブラウザ内の MediaPipe Pose (JavaScript) で実行します。Python/Node の WebSocket サーバーは不要です。

## 構成
- フロント/ランキング: XAMPP (Apache+PHP)
- ポーズ推定/スコア計算: MediaPipe Pose (JS) + クライアントサイド JavaScript

## 起動手順 (Windows)
1. XAMPP で Apache を起動（通常どおり）
2. ブラウザで Demo を開く（従来のURL）

## 補足
- 既定ではビデオのみ表示（骨格線は非表示）。必要であれば `script.js` の `SHOW_SKELETON` を `true` にします。
- スコア計算ロジックはフェアモード（reach/shoulder を height で正規化しクリップ＋平方根で緩和）をJSで再現しています。
- もし将来サーバー処理に戻したくなった場合は、`script.js` の `JS_ONLY` を `false` にし、WebSocket サーバーを用意してください。
