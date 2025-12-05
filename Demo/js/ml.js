// 軽量ランドマーク学習のブラウザ推論
// - 特徴量オブジェクト + 係数JSON(model.json) からスコアを計算
// - 線形: y = w·x + b （分類時はシグモイドする）

export function scoreWithModel(features, model) {
  const names = model.feature_names || [];
  const w = model.weights || [];
  const b = typeof model.bias === 'number' ? model.bias : 0;
  if (!names.length || names.length !== w.length) return 0;
  let dot = 0;
  for (let i = 0; i < names.length; i++) {
    const x = Number(features[names[i]] || 0);
    dot += w[i] * x;
  }
  let y = dot + b;
  if (model.model_type === 'logistic') {
    y = 1 / (1 + Math.exp(-y));
  }
  // 0〜1にクリップ
  if (!Number.isFinite(y)) y = 0;
  return Math.max(0, Math.min(1, y));
}

// 既存の computeCombatStatsFromLandmarks で作れる最小特徴の例を組み立てる
export function buildFeaturesFromStats(stats) {
  // reach_norm などは measurement.js の rN/sN/lN を使うのが理想だが、
  // ここでは身長比で割って近似する（measurement.js側で rN 等を外へ返したら差し替え）
  const h = Math.max(Number(stats.height || 0), 1e-6);
  const reach_norm = (Number(stats.reach || 0) / h) / 1.6;
  const shoulder_norm = (Number(stats.shoulder || 0) / h) / 1.6;
  const leg_norm = ((Number(stats.reach || 0) / h) / 2) / 1.6; // 仮: 本来は leg を使う
  return {
    reach_norm, shoulder_norm, leg_norm,
    poseN: Number(stats.pose || 0),
    exprN: Number(stats.expression || 0),
    stance_w: 0,
    elbowL_deg: 0, elbowR_deg: 0,
    kneeL_deg: 0, kneeR_deg: 0
  };
}
