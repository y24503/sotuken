# 軽量ランドマーク学習（ベースライン）

目的: MediaPipe Pose のランドマークから抽出した簡易特徴量で「ポーズ良さ」「表情強さ」などを回帰・分類する軽量モデルを作り、ブラウザで高速推論する。

構成:
- `train_landmark_model.py`: CSVの特徴量＋ラベルから線形モデル（回帰/分類）を学習し、係数をJSON出力
- `model.json`: 学習済み係数をブラウザで読み込むためのJSON（重み/バイアス/前処理）
- `js/ml.js`: ランドマークから特徴量を作り、`model.json` の係数でスコアを推論

学習用CSV仕様（例）:
- カラム: `reach_norm, shoulder_norm, leg_norm, poseN, exprN, stance_w, elbowL_deg, elbowR_deg, kneeL_deg, kneeR_deg, label`
- `label`: 目的に応じて数値（回帰）または0/1（分類）。

学習手順（Python, scikit-learn）:
1. 特徴量CSVを `ml/data/features.csv` に保存
2. 回帰: `python train_landmark_model.py --task regression --input ml/data/features.csv --output Demo/ml/model.json`
3. 分類: `python train_landmark_model.py --task classification --input ml/data/features.csv --output Demo/ml/model.json`

ブラウザ推論（概略）:
- `js/ml.js` の `scoreWithModel(features, modelJson)` を呼ぶ
- 既存の `computeCombatStatsFromLandmarks` で算出した `reach_norm, shoulder_norm, leg_norm, poseN, exprN` などを `features` に渡してスコア計算し、`styleRaw` にブレンド

注意:
- データが少ない場合は正則化（L2）を強めに。交差検証で過学習を確認。
- 顔サイズや距離に依存する指標は、身長比や顔ボックスのスケールで補正してから学習。
