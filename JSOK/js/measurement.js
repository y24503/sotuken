// measurement page logic (camera, pose, compute stats, save, 2p flow)
// (このファイルは measurement.html 専用のスクリプトです)
import { ensurePoseLoaded, createPose } from './mediapipe.js';

// --- DOM要素の取得 ---
const videoEl = document.getElementById('input-video'); // カメラ映像を表示する <video>
const canvasEl = document.getElementById('output-canvas'); // 映像を描画・スナップショットを取得する <canvas>
const socketStatus = document.getElementById('socket-status'); // 状態表示用 (LOADING POSE... など)
const totalPowerEl = document.getElementById('total-power'); // 総合戦闘力
const basePowerEl = document.getElementById('base-power'); // 基礎戦闘力
// ポーズ/表情/速度ボーナスの個別表示は不要になったため削除
const statHeight = document.getElementById('stat-height'); // 身長 (推定値)
const statReach = document.getElementById('stat-reach'); // リーチ (推定値)
const statShoulder = document.getElementById('stat-shoulder'); // 肩幅 (推定値)
const statExpression = document.getElementById('stat-expression'); // 表情 (推定値)
const statPose = document.getElementById('stat-pose'); // ポーズ (推定値)

const nameModal = document.getElementById('name-modal'); // 名前入力モーダル
const inputPlayerName = document.getElementById('input-player-name'); // 名前入力フィールド
const btnNameOk = document.getElementById('btn-name-ok'); // 名前入力OKボタン
const btnNameCancel = document.getElementById('btn-name-cancel'); // 名前入力キャンセルボタン
const btnStart = document.getElementById('btn-start-measure'); // 測定開始(START)ボタン
const btnExit = document.getElementById('btn-back-to-title-2'); // 終了(EXIT)ボタン

// --- グローバル変数 ---
let measureTimeout = null; // 測定タイマー (10秒カウントダウン用)
let lastSnapshotDataUrl = null; // 最後に撮影したスナップショット (Data URL形式)
let lastCombatStats = null; // 最後に計算された戦闘力データ
let showLandmarks = false; // ランドマーク表示フラグ（反転機能は削除）
const flipLandmarksHorizontally = true; // 画面上の体の向きとランドマークが逆の場合は true で左右反転描画

// 骨格接続ペア (簡略版) MediaPipe Pose の代表的な接続
const POSE_CONNECTIONS = [
    [11,12],[11,13],[13,15],[12,14],[14,16], // 上半身腕
    [11,23],[12,24],[23,24], // 腰
    [23,25],[25,27],[27,29],[24,26],[26,28],[28,30] // 脚
];

function drawLandmarks(ctx, lm) {
    if (!lm || lm.length === 0) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3b82f6'; // 青ライン (Tailwind blue-500 相当)
    ctx.shadowColor = '#3b82f6'; // 青発光
    ctx.shadowBlur = 12;
    POSE_CONNECTIONS.forEach(([a,b]) => {
        const p = lm[a];
        const q = lm[b];
        if (!p || !q) return;
        const px = (flipLandmarksHorizontally ? (1 - p.x) : p.x) * w;
        const py = p.y * h;
        const qx = (flipLandmarksHorizontally ? (1 - q.x) : q.x) * w;
        const qy = q.y * h;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(qx, qy);
        ctx.stroke();
    });
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ef4444'; // 赤点 (Tailwind red-500 相当)
    lm.forEach(p => {
        const px = (flipLandmarksHorizontally ? (1 - p.x) : p.x) * w;
        const py = p.y * h;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI*2);
        ctx.fill();
    });
    ctx.restore();
}

// --- ユーティリティ ---

/**
 * URLのクエリパラメータ (?player=1 など) をオブジェクトとして取得する
 * @returns {object} { player: "1" } のようなオブジェクト
 */
function getQueryParams() {
    const q = {};
    location.search.replace(/^\?/, '').split('&').forEach(p => {
        if (!p) return;
        const [k,v] = p.split('=');
        q[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return q;
}

// (旧バージョンの動的読み込みロジックは mediapipe.js へ集約済み)

// --- 戦闘力計算 ---

// 戦闘力計算用の定数 (script.js と互換性のある最小限のコピー)
// 速度要素を排除し、重みの重複を軽減した簡略版定数
const POWER_CONSTANTS = {
    baseline: 0,
    maxTotal: 500000,
    clipFeature: 1.6,
    // 速度(weightMotion) を除いたため Base+Style が1になるよう再正規化
    weightBase: 0.70,
    weightStyle: 0.30,
    // スタイル内部の比率・基礎内部の比率は既存維持
    weightPoseInStyle: 0.60,
    weightExprInStyle: 0.40,
    weightReachInBase: 0.40,
    weightShoulderInBase: 0.35,
    weightLegInBase: 0.25,
    genderMultiplier: { male: 1.00, female: 1.10 }
};

// 実身長の概算（任意）: 有効化するとカメラ距離と垂直FOVから概算m値を出します
const CAMERA_APPROX = {
    enable: true,    // 実身長[m]の概算を表示する
    distanceM: 3.0,  // カメラから被写体までの距離[m]
    vFovDeg: 40      // カメラの垂直画角[度]（必要に応じて校正）
};

// --- MediaPipe Pose 関連 ---
let pose = null; // MediaPipe Pose のインスタンス
let videoRenderRAF = null; // requestAnimationFrame ID (ビデオ描画用)
let poseRenderRAF = null; // requestAnimationFrame ID (ポーズ推定ループ用)
// 速度関連の変数は削除 (_prevForSpeed, _prevTimeMs, _speedEma)

/**
 * MediaPipeのランドマークから戦闘力を計算するコア関数
 * @param {Array} lm - MediaPipe Pose が出力したランドマーク (33点)
 * @returns {object} 計算された戦闘力・各種ステータス
 */
function computeCombatStatsFromLandmarks(lm) {
	// ランドマークが取得できていない場合は0で返す
    if (!lm || lm.length < 33) {
        return {
            base_power: 0, pose_bonus: 0, expression_bonus: 0, total_power: 0,
            height: 0, reach: 0, shoulder: 0, expression: 0, pose: 0,
            // ML用特徴量も0で埋めておく
            reach_norm: 0, shoulder_norm: 0, leg_norm: 0,
            stance_w: 0,
            elbowL_deg: 0, elbowR_deg: 0, kneeL_deg: 0, kneeR_deg: 0
        };
    }

    // --- ユーティリティ関数 (計算用) ---
    const v2 = (a, b) => Math.hypot((a.x - b.x), (a.y - b.y)); // 2点間の距離
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1); // 平均値
    const std = (arr) => { // 標準偏差
        const m = mean(arr);
        const v = mean(arr.map(x => (x - m) ** 2));
        return Math.sqrt(v);
    };
    const clip01 = (x) => Math.max(0, Math.min(1, x)); // 0.0〜1.0の範囲に値をクリップ

    // --- 必要なランドマークを取得 ---
    const top = lm[0]; // 鼻（旧コメント: 頭頂）
    const ankleL = lm[29]; // 左かかと（旧コメント: 左足首）
    const ankleR = lm[30]; // 右かかと（旧コメント: 右足首）
    const wristL = lm[15]; // 左手首
    const wristR = lm[16]; // 右手首
    const shoulderL = lm[11]; // 左肩
    const shoulderR = lm[12]; // 右肩
    const hipL = lm[23]; // 左腰
    const hipR = lm[24]; // 右腰

    // --- 1. 体格 (Base) の計算 ---
    // (各値はランドマークの座標(0〜1)に基づいているため、ピクセル単位ではない)
    // 画面内の身長比（0〜1）: 頭部候補の最上点〜足部候補の最下点
    const headCandidates = [lm[0], lm[2], lm[5], lm[7], lm[8]].filter(Boolean); // 鼻/両目/両耳
    const footCandidates = [lm[27], lm[28], lm[29], lm[30], lm[31], lm[32]].filter(Boolean); // 足首/かかと/つま先
    const headY = headCandidates.length ? Math.min(...headCandidates.map(p => p.y)) : top.y;
    const footY = footCandidates.length ? Math.max(...footCandidates.map(p => p.y)) : ((ankleL?.y + ankleR?.y) / 2 || top.y);
    const height = Math.max(0, Math.min(1, footY - headY));
    const reach = v2(wristL, wristR); // リーチ (両手首の距離)
    const shoulder = v2(shoulderL, shoulderR); // 肩幅 (両肩の距離)
    const leg = v2(hipL, ankleL) + v2(hipR, ankleR); // 両足の長さ (腰〜足首)

    // 身長で割る正規化はやめて、画面上の大きさそのものと身長の大きさで体格差を強調する
    // height は 0〜1 の範囲（画面内での見かけの身長比）
    const sizeN = clip01(height); // そのまま「大きさ係数」として利用
    const maxF = POWER_CONSTANTS.clipFeature; // 補正上限（スケール用）
    // リーチ・肩幅・脚の長さに sizeN を掛けることで、大柄な人ほど有利になるようにする
    const rN = clip01((reach * sizeN) / maxF);      // 体格込みリーチ
    const sN = clip01((shoulder * sizeN) / maxF);   // 体格込み肩幅
    const lN = clip01(((leg * sizeN) / 2) / maxF);  // 体格込み脚長（左右平均）

    // --- 2. スタイル (Style) の計算 ---
    const spineMid = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 }; // 背骨中央（腰）
    // 角度ベースの姿勢評価: 関節の曲がり具合と開き具合を0..1に集約
    function angle(a,b,c){
        const ab = {x:a.x-b.x, y:a.y-b.y};
        const cb = {x:c.x-b.x, y:c.y-b.y};
        const dot = ab.x*cb.x + ab.y*cb.y;
        const nab = Math.hypot(ab.x,ab.y); const ncb = Math.hypot(cb.x,cb.y);
        const cos = (nab>0 && ncb>0) ? (dot/(nab*ncb)) : 1;
        const ang = Math.acos(Math.max(-1, Math.min(1, cos))); // 0..π
        return ang;
    }
    // 肘・膝の曲げ: 伸びているほど高評価（角度がπに近い）
    const leftElbowAng = angle(lm[11], lm[13], lm[15]);
    const rightElbowAng = angle(lm[12], lm[14], lm[16]);
    const leftKneeAng = angle(lm[23], lm[25], lm[27]);
    const rightKneeAng = angle(lm[24], lm[26], lm[28]);
    function bendScore(theta){
        // 曲げ優遇: θ=0で1.0, θ=π/2で0.5, θ=πで0.0
        return clip01(1 - (theta/Math.PI));
    }
    const elbowScore = (bendScore(leftElbowAng)+bendScore(rightElbowAng))/2;
    const kneeScore = (bendScore(leftKneeAng)+bendScore(rightKneeAng))/2;
    // 開き具合: 肩幅比の腕開き/脚開きを評価（左右手首間と足首間の距離）
    // v2 は上で定義した2点間距離関数。dist2D の代わりに使用する。
    const handSpread = v2(lm[15], lm[16]);
    const footSpread = v2(lm[27], lm[28]);
    const shoulderWidth = v2(lm[11], lm[12]);
    const hipWidth = v2(lm[23], lm[24]);
    const handOpenN = clip01( handSpread / Math.max(shoulderWidth, 1e-6) );
    const footOpenN = clip01( footSpread / Math.max(hipWidth, 1e-6) );
    // 体幹直立度: 肩中心→腰中心ベクトルの縦向き具合
    const shoulderMid = { x:(lm[11].x+lm[12].x)/2, y:(lm[11].y+lm[12].y)/2 };
    const t = { x: spineMid.x - shoulderMid.x, y: spineMid.y - shoulderMid.y };
    const tlen = Math.hypot(t.x,t.y);
    const vy = (tlen>0) ? (t.y/tlen) : 1; // 上向きベクトルとの余弦（縦成分）
    const upright = clip01( (vy+1)/2 ); // -1..1 -> 0..1
    // 総合姿勢スコア（係数は経験値で調整可能）
    const poseN = clip01( 0.35*elbowScore + 0.25*kneeScore + 0.20*handOpenN + 0.10*footOpenN + 0.10*upright );

    // 立ち幅指標（ML用）：足の開き度合いをそのまま使う
    const stance_w = footOpenN;

    // 関節角度を度数に変換（ML用）
    const toDeg = (rad) => rad * 180 / Math.PI;
    const elbowL_deg = toDeg(leftElbowAng);
    const elbowR_deg = toDeg(rightElbowAng);
    const kneeL_deg = toDeg(leftKneeAng);
    const kneeR_deg = toDeg(rightKneeAng);
    const face = lm.slice(0, 5).map(p => [p.x, p.y]).flat(); // 顔の主要5点の座標
    const exprN = clip01(std(face) / 0.05); // 表情値（顔の標準偏差 = 顔の動き）

    // 速度(Motion)計算は削除

    // --- 4. 総合戦闘力の計算 ---
    // 各要素を重み付けして合算 (0〜1)
    const baseRaw = ( // 体格
        POWER_CONSTANTS.weightReachInBase * Math.pow(rN, 0.90) +
        POWER_CONSTANTS.weightShoulderInBase * Math.pow(sN, 0.85) +
        POWER_CONSTANTS.weightLegInBase * Math.pow(lN, 0.80)
    );
    const styleRaw = ( // スタイル
        POWER_CONSTANTS.weightPoseInStyle * poseN +
        POWER_CONSTANTS.weightExprInStyle * exprN
    );
    let combined = (
        POWER_CONSTANTS.weightBase * baseRaw +
        POWER_CONSTANTS.weightStyle * styleRaw
    );

    // 性別補正 (index.html側で設定された _selectedGender を参照)
    let gender = (window && window._selectedGender) ? window._selectedGender : 'male';
    const gmul = POWER_CONSTANTS.genderMultiplier[gender] || 1.0;
    combined = Math.min(1, combined * gmul); // 補正をかけて1.0でクリップ

    // 基礎点(baseline)からの上乗せ分(span)を計算
    const span = POWER_CONSTANTS.maxTotal; // 基礎点を廃止し、満点幅をそのまま使用
    // 各ボーナス項目を計算
    let base_amount = 0; // 基礎点の上乗せを廃止
    let pose_amount = span * POWER_CONSTANTS.weightStyle * POWER_CONSTANTS.weightPoseInStyle * poseN;
    let expr_amount = span * POWER_CONSTANTS.weightStyle * POWER_CONSTANTS.weightExprInStyle * exprN;
    
    // 性別補正を各項目にも適用
    base_amount *= gmul; pose_amount *= gmul; expr_amount *= gmul;
    
    let sumParts = base_amount + pose_amount + expr_amount;
    if (sumParts > span) { // 合計が上乗せ分を超えた場合、スケールダウンする
        const scale = span / sumParts;
    base_amount *= scale; pose_amount *= scale; expr_amount *= scale;
        sumParts = span;
    }
    // 基礎点 + 上乗せ分 = 最終戦闘力
    const total = Math.round(POWER_CONSTANTS.baseline + sumParts);

    // 実身長の概算（任意）
    let height_m = null;
    if (CAMERA_APPROX.enable) {
        try {
            const vfov = (CAMERA_APPROX.vFovDeg || 40) * Math.PI / 180;
            const sceneHeightM = 2 * (CAMERA_APPROX.distanceM || 3.0) * Math.tan(vfov / 2);
            height_m = sceneHeightM * height;
        } catch (e) {}
    }

    // 最終的なオブジェクトを返す
    return {
        base_power: Math.round(base_amount),
        pose_bonus: Math.round(pose_amount),
        expression_bonus: Math.round(expr_amount),
    // speed_bonus 削除
        total_power: total,
        height, // 画面内比率（0〜1）
        height_m, // 実身長の概算[m]（CAMERA_APPROX.enable=true のとき）
        reach, shoulder, expression: exprN, pose: poseN, // 生データ（デバッグ表示用）
        // ML用特徴量（CSVの列と合わせる）
        reach_norm: rN,
        shoulder_norm: sN,
        leg_norm: lN,
        stance_w,
        elbowL_deg,
        elbowR_deg,
        kneeL_deg,
        kneeR_deg
    };
}

/**
 * 計算された戦闘力(stats)をHTMLのUIに反映する
 * @param {object} stats - computeCombatStatsFromLandmarks が返したオブジェクト
 */
function updateStats(stats) {
    lastCombatStats = stats;
    try { totalPowerEl.textContent = stats.total_power.toLocaleString(); } catch(e){}
    try { basePowerEl.textContent = stats.base_power.toLocaleString(); } catch(e){}
    // ボーナス詳細は非表示要求により更新処理を省略
    try {
        if (typeof stats.height_m === 'number' && !Number.isNaN(stats.height_m)) {
            statHeight.textContent = `${stats.height_m.toFixed(2)} m`;
        } else if (typeof stats.height === 'number') {
            // 概算mが無効な場合のフォールバック（比率→cm相当っぽく見せるのは避け、%は出さない）
            // m表示希望に合わせ、概算が出ない時のみ比率を簡易換算: 2.0m視野高を仮定
            const approxM = 2.0 * (stats.height || 0);
            statHeight.textContent = `${approxM.toFixed(2)} m`;
        } else {
            statHeight.textContent = '-';
        }
    } catch(e){}
    try { statReach.textContent = stats.reach ? stats.reach.toFixed(2) : '-'; } catch(e){}
    try { statShoulder.textContent = stats.shoulder ? stats.shoulder.toFixed(2) : '-'; } catch(e){}
    try { statExpression.textContent = stats.expression ? stats.expression.toFixed(2) : '-'; } catch(e){}
    try { statPose.textContent = stats.pose ? stats.pose.toFixed(2) : '-'; } catch(e){}
}

async function initPose() {
    if (pose) return true;
    const ok = await ensurePoseLoaded(socketStatus);
    if (!ok) return false;
    const base = (window._mpPoseBase !== undefined) ? window._mpPoseBase : 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/';
    pose = await createPose({
        base,
        onResults: (results) => {
        if (results && results.poseLandmarks) {
            const stats = computeCombatStatsFromLandmarks(results.poseLandmarks);
            updateStats(stats);
        }
        // draw simple video->canvas background
        try {
            const ctx = canvasEl.getContext('2d');
            if (videoEl && videoEl.videoWidth) {
                if (canvasEl.width !== videoEl.videoWidth) canvasEl.width = videoEl.videoWidth;
                if (canvasEl.height !== videoEl.videoHeight) canvasEl.height = videoEl.videoHeight;
            }
            ctx.clearRect(0,0,canvasEl.width,canvasEl.height);
            ctx.save();
            if (videoEl && videoEl.videoWidth) {
                ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            }
            if (showLandmarks && results && results.poseLandmarks) {
                drawLandmarks(ctx, results.poseLandmarks);
            }
            ctx.restore();
        } catch(e){}
        }
    });
    return true;
}

/**
 * Webカメラを起動する
 */
async function openCamera() {
    try {
        const constraints = { video: true }; // ビデオのみ使用
        const stream = await navigator.mediaDevices.getUserMedia(constraints); // カメラアクセス許可を要求
        videoEl.srcObject = stream; // <video> タグにストリームを接続
        await videoEl.play(); // ビデオ再生開始
        if (socketStatus) { socketStatus.textContent = 'CAMERA READY'; }

        // ポーズ推定(pose.send)が始まる前も、ビデオ映像だけはCanvasに描画し続ける
        const startRender = () => {
            try {
                const w = videoEl.videoWidth || 640;
                const h = videoEl.videoHeight || 360;
                if (canvasEl.width !== w) canvasEl.width = w;
                if (canvasEl.height !== h) canvasEl.height = h;
                const ctx = canvasEl.getContext('2d');
                ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            } catch(e){}
            videoRenderRAF = requestAnimationFrame(startRender); // 次のフレームで再描画
        };
        startRender();

    } catch (err) {
        if (socketStatus) socketStatus.textContent = 'カメラ取得失敗';
    }
}

/**
 * ポーズ推定のループを開始する
 */
async function startPoseLoop() {
    const ok = await initPose(); // Poseライブラリの初期化
    if (!ok) {
        if (socketStatus) socketStatus.textContent = 'POSE NOT FOUND';
        return;
    }
    // 既に動いているビデオ描画ループ(videoRenderRAF)は停止せず、
    // 下のrun内で毎フレーム描画するため改めてキャンバス更新を統合
    if (videoRenderRAF) { cancelAnimationFrame(videoRenderRAF); videoRenderRAF = null; }

    // 毎フレーム、ビデオ映像を MediaPipe Pose に送信するループ
    const run = async () => {
        try {
            // 毎フレーム、ビデオフレームをキャンバスに描画（ポーズ結果がなくても更新）
            if (videoEl && videoEl.readyState >= 2) {
                const w = videoEl.videoWidth || canvasEl.width || 640;
                const h = videoEl.videoHeight || canvasEl.height || 360;
                if (canvasEl.width !== w) canvasEl.width = w;
                if (canvasEl.height !== h) canvasEl.height = h;
                const ctx = canvasEl.getContext('2d');
                ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            }
            // poseインスタンスがあり、ビデオが再生準備完了(readyState >= 2)なら
            if (pose && videoEl && videoEl.readyState >= 2) {
                await pose.send({ image: videoEl }); // ビデオフレームを送信
            }
        } catch(e){}
        poseRenderRAF = requestAnimationFrame(run); // 次のフレームで再度実行
    };
    run(); // ループ開始
}

/**
 * カメラとポーズ推定をすべて停止する
 */
function stopAll() {
    // カメラストリームを停止
    if (videoEl && videoEl.srcObject) {
        videoEl.srcObject.getTracks().forEach(t => t.stop());
        videoEl.srcObject = null;
    }
    // 全ての requestAnimationFrame ループを停止
    if (videoRenderRAF) cancelAnimationFrame(videoRenderRAF);
    if (poseRenderRAF) cancelAnimationFrame(poseRenderRAF);
    // Poseインスタンスを破棄
    if (pose) { 
        try { pose.close(); } catch(e){} 
        pose = null; 
    }
}

// --- イベントハンドラ ---

// STARTボタン: 10秒タイマーを開始し、完了後に名前入力モーダルを表示
btnStart && btnStart.addEventListener('click', () => {
    btnStart.disabled = true; // ボタンを無効化
    btnStart.textContent = 'MEASURING...';

    // ルーレット効果音（index.html と同じロジック）
    const seRoulette = document.getElementById('se-roulette');
    const seRoulette2 = document.getElementById('se-roulette2');
    if (seRoulette && seRoulette2) {
        seRoulette2.currentTime = 0;
        seRoulette2.play();
        seRoulette2.onended = () => {
            seRoulette2.onended = null;
            seRoulette2.currentTime = 0;
            seRoulette2.play();
            seRoulette2.onended = () => {
                seRoulette2.onended = null;
                seRoulette.currentTime = 0;
                seRoulette.play();
            };
        };
    }

    // 10秒後に実行
    measureTimeout = setTimeout(() => {
        try {
            // 10秒経過時点の <canvas> の内容を画像(jpeg)として取得
            const dataUrl = canvasEl.toDataURL('image/jpeg');
            lastSnapshotDataUrl = dataUrl; // グローバル変数に保存
            // 10秒経過時点の戦闘力(lastCombatStats)は、updateStats関数によって既にグローバル変数に保存されている
        } catch(e){}
        
        // 名前入力モーダルを表示
        nameModal.classList.remove('hidden');
        inputPlayerName.value = '';
        inputPlayerName.focus();
        // STARTボタンを再度有効化（キャンセルされた時用）
        btnStart.disabled = false;
        btnStart.textContent = 'START';
    }, 10000); // 10秒
});

// EXITボタン: すべて停止して index.html に戻る
btnExit && btnExit.addEventListener('click', () => {
    stopAll(); // カメラ等を停止
    window.location.href = 'index.html'; // メインページに戻る
});

// ランドマーク表示トグル
const toggleLmBtn = document.getElementById('toggle-landmarks');
if (toggleLmBtn) {
    // 再確認: クリック届いているかログ
    toggleLmBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showLandmarks = !showLandmarks;
        toggleLmBtn.textContent = showLandmarks ? 'ON' : 'OFF';
        console.log('[LANDMARK-TOGGLE] switched ->', showLandmarks);
    });
}

// --- 保存API (サーバーへの送信) ---
/**
 * 測定結果をサーバー (/api/save_score) に送信する
 * @param {object} combatStats - 戦闘力データ
 * @param {string} imageDataUrl - スナップショット画像 (Data URL)
 * @param {string} name - プレイヤー名
 * @returns {Promise<object|null>} サーバーからの応答JSON、またはエラー時 null
 */
async function saveResultToDB(combatStats, imageDataUrl, name = 'PLAYER') {
    try {
        const res = await fetch('/api/save_score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                score: combatStats && combatStats.total_power ? combatStats.total_power : 0,
                image: imageDataUrl // 画像データも一緒に送信
            })
        });
        const json = await res.json();
        // 保存成功時、プレビュー画像（あれば）を表示
        if (json && json.success && json.image) {
            try {
                const preview = document.getElementById('save-preview');
                if (preview) preview.src = `src/${encodeURIComponent(json.image)}`;
            } catch(e){}
        }
        // 最近保存IDをハイライト用に保存
        try { if (json && json.id) sessionStorage.setItem('recentSavedId', String(json.id)); } catch(e){}
        return json;
    } catch (e) {
        alert('保存に失敗しました');
        return null;
    }
}

// --- 学習用特徴量のログ送信 ---
async function logFeaturesForTraining(combatStats) {
    if (!combatStats) return;
    try {
        const payload = {
            reach_norm: combatStats.reach_norm ?? 0,
            shoulder_norm: combatStats.shoulder_norm ?? 0,
            leg_norm: combatStats.leg_norm ?? 0,
            poseN: combatStats.pose ?? 0,
            exprN: combatStats.expression ?? 0,
            stance_w: combatStats.stance_w ?? 0,
            elbowL_deg: combatStats.elbowL_deg ?? 0,
            elbowR_deg: combatStats.elbowR_deg ?? 0,
            kneeL_deg: combatStats.kneeL_deg ?? 0,
            kneeR_deg: combatStats.kneeR_deg ?? 0,
            // ラベルには現在のルールベース戦闘力をそのまま使う
            label: combatStats.total_power ?? 0
        };
        await fetch('/api/log_features', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch(e) {
        console.warn('log_features failed', e);
    }
}

// --- 名前入力モーダルの処理 (OK / Cancel) ---

// OKボタン: 2P対戦フローの核心
btnNameOk && btnNameOk.addEventListener('click', async () => {
    const name = inputPlayerName.value.trim() || 'PLAYER'; // 名前を取得
    nameModal.classList.add('hidden'); // モーダルを閉じる

    // データをサーバーに保存（ランキング登録）
    const currentStats = lastCombatStats || { total_power: POWER_CONSTANTS.baseline };
    const saveJson = await saveResultToDB(currentStats, lastSnapshotDataUrl || '', name);
    // 学習用に特徴量をCSVへ1行追加
    logFeaturesForTraining(currentStats);

    // --- 2人測定モード (2pmeasure) の判定 ---
    let bs = {}; // battleState
    try {
        bs = JSON.parse(sessionStorage.getItem('battleState') || '{}');
    } catch(e){}
    // 2Pフロー復旧: battleStateが欠落していて twoPlayerActive フラグがある場合再構築
    if ((!bs || !bs.mode) && sessionStorage.getItem('twoPlayerActive') === '1') {
        const q2 = getQueryParams();
        const pnum = q2.player ? Number(q2.player) : 1;
        bs = { mode: '2pmeasure', step: (pnum === 1 ? 202 : 203), player1: {}, player2: {} };
    }
    
    const q = getQueryParams(); // URLから ?player=1 などを取得
    const playerNum = q.player ? Number(q.player) : 1; // 自分がP1かP2か

    // 2P対戦モードの場合
    if (bs && bs.mode === '2pmeasure') {
        // サーバーに保存された画像パス (src/...) があればそれ、なければDataURL
        const savedImgPath = (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl;

        // --- P1 の測定が完了した場合 ---
        // (ステップが202 (P1測定中) AND 自分がP1)
        if (bs.step === 202 && playerNum === 1) {
            // P1の既存情報（genderなど）を維持しつつ測定結果を反映
            const prev = bs.player1 || {};
            bs.player1 = {
                ...prev,
                name: name || prev.name || 'PLAYER1',
                score: (lastCombatStats && lastCombatStats.total_power) || prev.score || 0,
                maxScore: (lastCombatStats && lastCombatStats.total_power) || prev.maxScore || ((lastCombatStats && lastCombatStats.total_power) || prev.score || 0),
                image: savedImgPath || prev.image
            };
            bs.step = 203; // ステップを「P2測定中」に進める
            // sessionStorage を更新
            sessionStorage.setItem('battleState', JSON.stringify(bs));
            // P2 測定前に 2人目性別選択画面へ戻る
            window.location.href = 'index.html';
            return; // 処理終了
        }
        
        // --- P2 の測定が完了した場合 ---
        // (ステップが203 (P2測定中) AND 自分がP2)
        if (bs.step === 203 && playerNum === 2) {
            // P2の既存情報（genderなど）を維持しつつ測定結果を反映
            const prev2 = bs.player2 || {};
            const img2 = (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl;
            bs.player2 = {
                ...prev2,
                name: name || prev2.name || 'PLAYER2',
                score: (lastCombatStats && lastCombatStats.total_power) || prev2.score || 0,
                maxScore: (lastCombatStats && lastCombatStats.total_power) || prev2.maxScore || ((lastCombatStats && lastCombatStats.total_power) || prev2.score || 0),
                image: img2 || prev2.image
            };
            bs.step = 204; // ステップを「両者測定完了」に進める
            // sessionStorage を更新
            sessionStorage.setItem('battleState', JSON.stringify(bs));
            
            // index.html に戻る (戻った先で index.html の復帰処理が走り、バトル画面が表示される)
            window.location.href = 'index.html';
            return; // 処理終了
        }
    
    } else {
        // 1P（単独）測定の場合のみランキングへ
        window.location.href = 'ranking.html';
    }
});

// Cancelボタン: モーダルを閉じるだけ
btnNameCancel && btnNameCancel.addEventListener('click', () => {
    nameModal.classList.add('hidden');
});

// --- 初期化処理 ---
// ページ読み込み完了時にカメラ起動とポーズ推定ループを開始
window.addEventListener('DOMContentLoaded', async () => {
    // 2Pモードの場合は選択済み性別を反映
    try {
        const bs = JSON.parse(sessionStorage.getItem('battleState') || '{}');
        const q = getQueryParams();
        const playerNum = q.player ? Number(q.player) : 1;
        if (bs && bs.mode === '2pmeasure') {
            if (playerNum === 1 && bs.player1 && bs.player1.gender) {
                window._selectedGender = bs.player1.gender;
            } else if (playerNum === 2 && bs.player2 && bs.player2.gender) {
                window._selectedGender = bs.player2.gender;
            }
        }
    } catch(e){}
    await openCamera();
    await startPoseLoop();
});

// --- グローバル公開 ---
// index.html (script.js) など他スクリプトからこのページの関数を呼び出せるように、
// window オブジェクトに関数を"エクスポート"（代入）する
// (重複定義を避けるためのラッパー関数などで使われる)
try { window.computeCombatStatsFromLandmarks = computeCombatStatsFromLandmarks; } catch(e){}
try { window.updateStats = updateStats; } catch(e){}
try { window.ensurePoseLoaded = ensurePoseLoaded; } catch(e){}
try { window.initPose = initPose; } catch(e){}
try { window.openCamera = openCamera; } catch(e){}
try { window.startPoseLoop = startPoseLoop; } catch(e){}
try { window.stopMeasurement = stopAll; } catch(e){} // エイリアス名 (script.js からの呼び出しを想定)
try { window.stopAll = stopAll; } catch(e){} // 既存名も公開
try { window.saveResultToDB = saveResultToDB; } catch(e){}
// このページ単体でテスト・実行するための簡易関数
try { window.startMeasurementPage = async function(playerNum){ await openCamera(); await startPoseLoop(); }; } catch(e){}