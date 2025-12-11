#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
軽量ランドマーク学習ベースライン
- 入力: 特徴量CSV（ヘッダあり）
- 出力: 係数JSON（Demo/ml/model.json など）

使い方:
  回帰:
    python train_landmark_model.py --task regression --input ml/data/features.csv --output Demo/ml/model.json
  分類:
    python train_landmark_model.py --task classification --input ml/data/features.csv --output Demo/ml/model.json
"""
import argparse
import json
import os

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error, accuracy_score

FEATURE_COLUMNS = [
    'reach_norm','shoulder_norm','leg_norm','poseN','exprN',
    'stance_w','elbowL_deg','elbowR_deg','kneeL_deg','kneeR_deg'
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--task', choices=['regression','classification'], required=True)
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--alpha', type=float, default=1.0)  # Ridge正則化強度
    ap.add_argument('--C', type=float, default=1.0)      # Logistic正則化逆数
    args = ap.parse_args()

    df = pd.read_csv(args.input)
    for col in FEATURE_COLUMNS + ['label']:
        if col not in df.columns:
            raise ValueError(f'CSVに必要なカラムがありません: {col}')

    X = df[FEATURE_COLUMNS].values.astype(np.float32)
    y = df['label'].values

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    if args.task == 'regression':
        model = Ridge(alpha=args.alpha, random_state=42)
        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)
        print('R2=', r2_score(y_test, y_pred), 'MAE=', mean_absolute_error(y_test, y_pred))
        weights = model.coef_.tolist()
        bias = float(model.intercept_)
        model_type = 'ridge'
    else:
        # 二値分類（0/1）想定
        model = LogisticRegression(C=args.C, max_iter=1000, solver='lbfgs')
        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)
        print('ACC=', accuracy_score(y_test, y_pred))
        weights = model.coef_[0].tolist()
        bias = float(model.intercept_[0])
        model_type = 'logistic'

    out = {
        'model_type': model_type,
        'feature_names': FEATURE_COLUMNS,
        'weights': weights,
        'bias': bias,
        'preprocess': {
            # z-score標準化などを将来入れる余地（今はパス）
            'type': 'none'
        }
    }
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('saved ->', args.output)

if __name__ == '__main__':
    main()
