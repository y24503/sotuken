# POWER SCAN / sotuken 操作手順ガイド

## 1. 概要
POWER SCAN はブラウザ上で MediaPipe Pose (JavaScript) を用いて人物の簡易的な身体特徴とスタイル指標から "戦闘力" を算出し、ランキング保存・2人対戦演出を行うデモです。サーバー側は最低限の API 提供のみ (Node / PHP / Python のいずれか構成) で、解析はすべてクライアントサイドで実行します。

## 2. 主な機能
- Webカメラ映像のリアルタイム解析 (身長/リーチ/肩幅/姿勢/表情 指標)
- 戦闘力スコア算出 (速度要素は現在無効化済み)
- スナップショット撮影 & ランキング保存 (画像 + スコア + 名前)
- 2人測定モード (P1 → P2 → バトル演出)
- BGM/SE 再生管理
- ランキング表示・個別削除

## 3. ディレクトリ概要 (抜粋)
```
App/        旧/別構成 (PHP, Python, Node 起動用バッチ)
Demo/       現行 JS クライアント + Node API
	js/       フロントロジック (script.js, measurement.js, mediapipe.js, ranking.js)
	node/     Node サーバ (server.js, package.json)
	mediapipe/pose/  ローカル展開した MediaPipe Pose 資産 (pose.js / wasm / .tflite / .binarypb)
	sfx/, music/, src/  効果音・BGM・保存画像
```

## 4. 動作要件
- OS: Windows 10/11 (他環境でも概ね動作可)
- Node.js: v16+ 推奨 (Demo/node 用 API 起動に使用)
- Webブラウザ: 最新 Chrome/Edge (HTTPS でなくてもローカルならカメラ取得可能)
- 追加: カメラデバイス権限

## 5. 初回セットアップ手順 (Demo 利用)
1. Node インストール (未導入の場合)
2. `Demo\run_ws.bat` を一度起動 (自動で `npm install` 実行) 例: ダブルクリック or コマンドライン `Demo\run_ws.bat 8080`
3. MediaPipe Pose 資産を取得 (次章参照)
4. ブラウザで `http://localhost:8080/` を開く

## 6. MediaPipe Pose 資産取得
ローカルで CDN に依存せず動かすため、`Demo/mediapipe/pose/` に以下が存在する必要があります:
- `pose.js` / `pose_solution_(.*).wasm` / `pose_solution_(.*).data`
- モデル: `pose_landmark_lite.tflite`, `pose_landmark_full.tflite`, `pose_landmark_heavy.tflite`
- グラフ: `pose_web.binarypb`

取得方法:
1. 既存の `download_pose.bat` (Demo 直下) を実行 (内部で PowerShell へフォールバックする構成を想定) 失敗する場合は `mediapipe/pose/get_pose.ps1` を PowerShell で直接実行。
2. `node_modules/@mediapipe/pose/` にインストールされている場合は必要ファイルを `mediapipe/pose/` にコピー。バージョンは現在 `0.5.1675469404`。

確認コマンド例 (PowerShell):
```powershell
Get-ChildItem Demo/mediapipe/pose | Select-Object Name,Length
```

## 7. 起動方法
### Node (推奨 / Demo)
```
Demo\run_ws.bat 8080
```
アクセス: `http://localhost:8080/` 
ポート変更: 第1引数に任意のポート番号。第2引数 `bg` で新しいウィンドウに起動。

### PHP (App) ※必要な場合のみ
Apache (XAMPP 等) を起動し `App/` を DocumentRoot に配置。`api.php` がランキング API を提供します。

### Python WebSocket (旧構成) / Node WS (App)
`App\run_ws.bat` または `App\run_node_ws.bat` を使用。現行 Demo 構成では不要です。

## 8. 測定 (1人モード)
1. タイトルから性別選択へ進む
2. 性別ボタン (male / female) をクリックすると `measurement.html?player=1` に遷移
3. START → 10秒カウント後にスナップショット撮影 & 名前入力モーダル表示
4. 名前入力 OK → ランキングへ保存 / ランキング画面へ遷移

計算指標: 身長/リーチ/肩幅/姿勢/表情。速度は現在使用していません (`measurement.js` から削除済み)。

## 9. 2人測定フロー
1. タイトルで「2Pたいせん」を選択 → 準備画面 START
2. `battleState.mode = '2pmeasure'` / `step=202` (P1測定中)
3. P1測定完了 → 自動で P2 (`step=203`) の測定へ遷移
4. P2完了 → index.html 戻り (`step=204`) でバトル画面自動表示
5. `sessionStorage` の `battleState` はバトル開始後削除されます

URL パラメータ: `measurement.html?player=1` / `?player=2` がプレイヤー識別に使用されます。

## 10. ランキング
- 保存 API: `POST /api/save_score` (name, score, image DataURL)
- 取得 API: `GET /api/ranking` (実装側で異なる場合あり)
- 削除 API: `POST /api/delete_score` (id)
- 画像は `Demo/src/` 以下に保存 (DB ではなく CSV/ファイルパス管理想定)

## 11. カスタマイズ
`Demo/js/measurement.js` の `POWER_CONSTANTS`:
- 重み: `weightBase` / `weightStyle` (現在 0.70 / 0.30)
- 性別補正: `genderMultiplier`
- 速度復活: 以前の `weightMotion`, `clipSpeed`, 速度計算ブロックを再挿入

数値を調整後、ブラウザ再読み込みで反映。ビルド工程は不要。

## 12. トラブルシューティング
| 症状 | 原因 | 対処 |
|------|------|------|
| POSE NOT FOUND | `pose.js` 未取得 / 読み込み失敗 | `mediapipe/pose/` 内ファイル確認 / CDN ではなくローカルファイルを優先 |
| 404 (pose_landmark_*.tflite) | モデル未コピー | `node_modules/@mediapipe/pose/` から `.tflite` をコピー |
| カメラ取得失敗 | ブラウザ権限未許可 / 他アプリ占有 | タブのカメラ許可、他アプリ終了、再読み込み |
| スコアが更新されない | Pose 推定が開始されていない | コンソールでエラー確認 / `ensurePoseLoaded` 成功を確認 |
| 画像が保存されない | API 失敗 / 形式不正 | ネットワークログ / `api/save_score` のレスポンス確認 |

## 13. 開発メモ / 拡張ポイント
- 描画: 現在ビデオフレームのみ。骨格線描画を追加する場合は `mediapipe.js` の `onResults` 内で `results.poseLandmarks` を使い canvas 描画。
- パフォーマンス: 不要な DOM 更新 (削除済みボーナス) は避け済み。さらに軽量化は requestAnimationFrame の条件分岐最適化で可能。
- データ永続化: CSV → SQLite / PostgreSQL 等へ拡張可能。API 部分を ORMapper で再実装。
- モデル切替: `modelComplexity` (0:lite /1:full /2:heavy) を UI ボタン追加し `pose.setOptions` で変更。

## 14. セキュリティ / 注意
- 画像と名前はサニタイズが必要 (ランキング表示時の XSS 対策: 現行実装は最小限のエスケープ)。
- 開発時に公開サーバーへそのまま配置する場合は HTTPS + CSP 等を検討。

## 15. ライセンス / クレジット
- MediaPipe Pose: Google MediaPipe ライセンスに従う
- フォント: Google Fonts (Orbitron, Share Tech Mono)
- 効果音/BGM: 自作またはライセンス確認済みのものを配置すること

---
不明点・改善要望があれば issue / PR / 追加質問でお知らせください。

## 16. 機能説明（レポート）

**1) 背景・目的**
- Webブラウザのみで人物の身体指標を推定し、直感的な「戦闘力」スコアとして提示する体験デモ。
- サーバー負荷の高い推論処理をクライアント側（MediaPipe Pose JS）にオフロードし、低遅延なインタラクションを実現。

**2) 要求仕様（抜粋）**
- カメラ入力の許諾取得と映像プレビュー表示。
- ポーズ推定に基づく指標（身長・リーチ・肩幅・姿勢・表情）の算出。
- 指標を重み付けして戦闘力へ集約（速度要素は現行バージョンでは無効）。
- スナップショット撮影とスコアの保存（名前・画像・数値）／ランキング表示・削除。
- 2人測定モード（P1→P2→バトル演出）により対戦体験を提供。

**3) システム構成**
- フロントエンド: HTML/CSS(Tailwind) + ES Modules（`Demo/js/*`）。
- 推論: MediaPipe Pose（`@mediapipe/pose` v0.5.1675469404）。CDN不通時はローカル資産を使用。
- API: Node/Express の簡易REST（ランキング保存/取得/削除）。
- データ保存: 画像は `Demo/src/` に、スコアは CSV/ファイルで管理（実装依存）。

**4) 機能一覧**
- 測定: `measurement.html` でカメラ起動・推定実行・スコア更新・撮影・命名。
- ランキング: 一覧表示、個別削除（管理用確認ダイアログ）。
- 2人対戦: 状態を `sessionStorage` で受け渡し、P1/P2完了後に演出表示。
- メディア: BGM 選択・再生、ボタン/ルーレット SE 再生。

**5) アルゴリズム概要**
- 入力: MediaPipe Pose の33ランドマーク。
- 基礎（Base）: 身長正規化したリーチ/肩幅/脚長を加重合成（既定 0.70）。
- スタイル（Style）: 姿勢（頭頂—腰距離）と表情（顔座標の標準偏差）を合成（既定 0.30）。
- 性別補正: `genderMultiplier` を最終値に適用（female=1.09 既定）。
- 出力: `baseline` に加点した総合戦闘力（上限 `maxTotal`）。

**6) UI/体験フロー**
- タイトル → 遊び方/ランキング/2P準備 へナビゲーション。
- 測定（1P）: 性別選択 → 測定 → 撮影 → 名前入力 → 保存/ランキングへ。
- 測定（2P）: P1 測定完 → 自動で P2 → 完了後にバトル演出。

**7) データフロー**
- 推定: `mediapipe.js` が Pose を初期化（ローカル資産優先, `createPose`）。
- 集計: `measurement.js` が `computeCombatStatsFromLandmarks` でスコア算出。
- 保存: `POST /api/save_score`（name, score, image DataURL）。
- 表示: `ranking.js` が一覧取得 → DOM描画。削除は `POST /api/delete_score`。

**8) 非機能要件/考慮**
- パフォーマンス: クライアント推論により遅延を最小化。描画更新の冪等性を確保。
- 可用性: CDN 不通時にローカル資産へフォールバック、初回起動時の依存解決をバッチ化。
- セキュリティ: 画像/名前のサニタイズ、公開運用時は HTTPS・CSP を推奨。

**9) 既知の制限と対策**
- カメラ権限: 一部ブラウザポリシーに依存。ローカル HTTP では動作可だが HTTPS 推奨。
- モデル資産: `pose_landmark_*.tflite` / `pose_web.binarypb` 未配置で 404。`Demo/mediapipe/pose/` を確認。
- バージョン整合: `@mediapipe/pose` の発行済バージョンに合わせる（本プロジェクトは 0.5.1675469404）。

**10) 今後の拡張**
- 速度要素の再導入（計測安定化後、軽量な動き特徴量として復帰）。
- モデル切替 UI（lite/full/heavy）と動的 `setOptions`。
- データ層の強化（CSV→RDBMS）・画像ストレージ連携。
- 骨格線描画・ポーズガイド UI の導入。