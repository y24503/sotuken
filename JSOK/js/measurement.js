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
// 追加: 脚長表示要素
const statLeg = document.getElementById('stat-leg'); // 脚長 (推定値)

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
let snapshotCombatStats = null; // 写真撮影タイミングで確定させた戦闘力
let measurementLocked = false; // 写真撮影後は戦闘力を更新しないためのロック
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
        ctx.arc(px, py, 2, 0, Math.PI*2);
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

// --- 戦闘力計算 ---
// 戦闘力計算用の定数 (script.js と互換性のある最小限のコピー)
const POWER_CONSTANTS = {
    weightBase: 0.70,
    weightStyle: 0.30,
};

// 実身長の概算（任意）: 有効化するとカメラ距離と垂直FOVから概算m値を出します
const CAMERA_APPROX = {
    enable: true,    // 実身長[m]の概算を表示する
    distanceM: 3.0, //カメラから被写体までの距離[m]
    vFovDeg: 50     // カメラの垂直画角[度]（必要に応じて校正）
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
    // ランドマークが取得できていない場合は最低値を返す
    if (!lm || lm.length < 33) {
        return {
            base_power: 0, pose_bonus: 0, expression_bonus: 0, total_power: 0,
            height: 0, height_m: null, reach: 0, shoulder: 0, expression: 0, pose: 0, leg: 0
        };
    }

    // --- ユーティリティ関数 ---
    const v2 = (a, b) => Math.hypot((a.x - b.x), (a.y - b.y));
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
    const std = (arr) => { const m = mean(arr); const v = mean(arr.map(x => (x - m) ** 2)); return Math.sqrt(v); };
    const clip01 = (x) => Math.max(0, Math.min(1, x));
    // 簡易距離ユーティリティ（2D）
    const dist2D = (a,b) => (a && b) ? Math.hypot(a.x - b.x, a.y - b.y) : 0;

    // --- 安全なランドマーク取得（未定義ガード） ---
    const lp = (i) => (lm && lm[i]) ? lm[i] : { x: 0.5, y: 0.5 }; // 中心値を返すことで極端な影響を抑える

    // --- 基本ランドマーク取得（safe） ---
    const top = lp(0);
    const ankleL = lp(29), ankleR = lp(30);
    const wristL = lp(15), wristR = lp(16);
    const shoulderL = lp(11), shoulderR = lp(12);
    const hipL = lp(23), hipR = lp(24);

    // --- 身長比・各特徴量計算 ---
    const headCandidates = [lp(0), lp(2), lp(5), lp(7), lp(8)].filter(Boolean);
    const footCandidates = [lp(27), lp(28), lp(29), lp(30), lp(31), lp(32)].filter(Boolean);
    const headY = headCandidates.length ? Math.min(...headCandidates.map(p => p.y)) : top.y;
    const footY = footCandidates.length ? Math.max(...footCandidates.map(p => p.y)) : ((ankleL.y + ankleR.y) / 2 || top.y);
    const height = Math.max(0, Math.min(1, footY - headY)); // 画面内比率

    // 変更: リーチを左右の「肩→手首」距離の合計に変更（脚長と同様に左右合算）。
    const reachL = dist2D(shoulderL, wristL);    // 左腕の長さ相当
    const reachR = dist2D(shoulderR, wristR);    // 右腕の長さ相当
    const reach = reachL + reachR;               // 両腕合計（相対距離）
    const shoulder = dist2D(shoulderL, shoulderR); // 肩幅（相対距離）
    const leg = dist2D(hipL, ankleL) + dist2D(hipR, ankleR); // 両脚合計
// --- 新・ポーズ（Pose）：手足の開放度と広がり ---
    
    // 1. 体の「中心」と「基準サイズ」を決める
    const _shoulderMid = { x: (shoulderL.x + shoulderR.x)/2, y: (shoulderL.y + shoulderR.y)/2 };
    const _hipMid = { x: (hipL.x + hipR.x)/2, y: (hipL.y + hipR.y)/2 };
    const _torsoLen = Math.hypot(_shoulderMid.x - _hipMid.x, _shoulderMid.y - _hipMid.y);
    const _baseScale = (_torsoLen > 0.01) ? _torsoLen : 1.0; // ゼロ除算防止

    // 2. 腕の広がり（胴体に対する比率）
    const _armDistL = Math.hypot(wristL.x - shoulderL.x, wristL.y - shoulderL.y);
    const _armDistR = Math.hypot(wristR.x - shoulderR.x, wristR.y - shoulderR.y);
    const _armOpenness = (_armDistL + _armDistR) / _baseScale; 

    // 3. 足の広がり
    const _legSpread = Math.hypot(ankleL.x - ankleR.x, ankleL.y - ankleR.y);
    const _legOpenness = _legSpread / _baseScale;

    // 4. 高さボーナス（手が肩より上にあるか）
    let _handHeightBonus = 0;
    if (wristL.y < shoulderL.y) _handHeightBonus += 0.5;
    if (wristR.y < shoulderR.y) _handHeightBonus += 0.5;

    // 5. 総合スコア計算
    const _rawPoseScore = (_armOpenness * 1.0) + (_legOpenness * 0.8) + (_handHeightBonus * 0.3);

    // 6. 正規化（ここが poseN になります）
    // 基準値：2.0(棒立ち) 〜 3.5(派手なポーズ)
    const poseN = Math.max(0, Math.min((_rawPoseScore - 2.0) / (3.5 - 2.0), 1.0));
 // 1. 座標取得
 const _eL = lm[2] || {x:0,y:0}; // 左目
 const _eR = lm[5] || {x:0,y:0}; // 右目
 const _mL = lm[9] || {x:0,y:0}; // 口の左端
 const _mR = lm[10] || {x:0,y:0}; // 口の右端

 // 2. 基準：目の幅（カメラ距離の補正用）
 const _eyeW = Math.hypot(_eL.x - _eR.x, _eL.y - _eR.y);
 
 // エラー回避（遠すぎる、または検出ミス）
 let _vScore = 0; // 縦のスコア
 let _hScore = 0; // 横のスコア

 if (_eyeW > 0.005) {
     // --- A. 縦の判定（叫び） ---
     // 目と口の縦距離
     const _vertDist = Math.abs(((_mL.y + _mR.y)/2) - ((_eL.y + _eR.y)/2));
     const _vRatio = _vertDist / _eyeW;
     
     // 縦の閾値（Threshold）: 0.7(真顔) 〜 1.2(叫び)
     _vScore = (_vRatio - 0.7) / (1.2 - 0.7);

     // --- B. 横の判定（食いしばり・ニカッ） ---
     // 口の横幅
     const _horizDist = Math.hypot(_mL.x - _mR.x, _mL.y - _mR.y);
     const _hRatio = _horizDist / _eyeW;

     // 横の閾値（Threshold）: 0.4(真顔) 〜 0.65(全開)
     _hScore = (_hRatio - 0.40) / (0.65 - 0.40);
 }

 // 3. 統合：縦と横、どっちか「すごい方」を採用する
 // 両方を0.0〜1.0の範囲に収めてから比較
 const _vFinal = Math.max(0, Math.min(_vScore, 1.0));
 const _hFinal = Math.max(0, Math.min(_hScore, 1.0));

 // 大きい方を採用（叫んでも、笑ってもOK）
 const exprN = Math.max(_vFinal, _hFinal);
    // --- 身長[m]/cm の推定 ---
    let height_m = null;
    if (CAMERA_APPROX.enable) {
        try {
            const vfov = (CAMERA_APPROX.vFovDeg || 40) * Math.PI / 180;
            const sceneHeightM = 2 * (CAMERA_APPROX.distanceM || 3.0) * Math.tan(vfov / 2);
            // height が 0 のときは sceneHeightM * 0 になるので無効と判断
            if (height > 1e-6) height_m = sceneHeightM * height;
        } catch(e) { height_m = null; }
    }
    // フォールバック：視野高さ=2.0mを仮定（height が小さい場合でも安全化）
    if (!height_m || !isFinite(height_m) || height_m <= 0.001) {
        height_m = 2.0 * height;
    }
    const height_cm = (isFinite(height_m) && height_m > 0) ? height_m * 100 : NaN; // cm単位（無効なら NaN）

    // --- 体格（physique）計算（性別依存） ---
    let gender = (window && window._selectedGender) ? window._selectedGender : 'male';
    
    const maleBaseM = 1.71;   // 170.8 cm
    const femaleBaseM = 1.58;  // 158.0 cm
    const stepM = 0.01;        // 1 cm単位
    const perStepDelta = 2000; // 基本の変動値（1000点）
    
    let physique = 1; // 基礎点

    // 身長mが取れていれば使う。取れていなければ平均値を使う
    const effectiveM = (isFinite(height_m) && height_m > 0) ? height_m : (gender === 'female' ? femaleBaseM : maleBaseM);
    const baseM = (gender === 'female') ? femaleBaseM : maleBaseM;

    // 1. 平均との差分（ステップ数）を計算
    // プラスなら平均より高い、マイナスなら平均より低い
    const steps = Math.round((effectiveM - baseM) / stepM);

    // 2. 加点・減点の計算（ここが変更点）
    let physiqueBonus = 0;

    if (steps >= 0) {
        // 平均以上：そのまま1000点ずつ加点
        physiqueBonus = steps * perStepDelta;
    } else {
        // 平均未満：減点幅を半分（500点）にする
        // stepsがマイナスなので、足し算すれば自然に減点になります
        physiqueBonus = steps * (perStepDelta / 2); 
    }

    // 3. 最終的な体格スコア
    physique = physique + physiqueBonus;

    if (!isFinite(physique)) physique = 0;

    // --- 他の内訳（単純スケール） ---
    // 肩幅・ポーズ・表情・リーチ等の寄与を目立たせる（各スケールを上げる）
    const shoulder_component = Math.round(shoulder * 70000);      // 例: 0.4 -> ~2000
    const pose_component = Math.round(poseN * 80000);            // ポーズの影響を大きめに
    const expr_component = Math.round(exprN * 80000);            // 表情の影響
    const reach_component = Math.round(reach * 50000);            // リーチ（手の広がり）を追加寄与
    const leg_component = Math.round(leg * 50000);                // 脚の長さ合算も少し寄与

    // ランダムは小さくして揺らぎだけを残す（1〜2000）
    const randomComponent = Math.floor(Math.random() * 150001);

    // --- 合算（POWER_CONSTANTS の重みを利用して調整） ---
    const heightPart = physique; // 体格ベース
    const stylePart = shoulder_component + pose_component + expr_component + reach_component + leg_component;
    const total = Math.round(heightPart + stylePart + randomComponent);

    // 戻り値（UI更新用）
    return {
        base_power: Math.round(physique),           // 体格を base_power として表示
        pose_bonus: Math.round(pose_component),
        expression_bonus: Math.round(expr_component),
        total_power: Math.round(total),
        height, height_m, reach, shoulder,  // 既存
        expression: exprN, pose: poseN,
        leg, // 追加: 脚長を返す
        // 内訳（デバッグ表示用）
        _components: { shoulder_component, expr_component, pose_component, reach_component, leg_component, randomComponent, physique, height_cm, gender }
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
    // 追加: 脚長表示（reach と同様の表示形式）
    try { statLeg.textContent = stats.leg ? stats.leg.toFixed(2) : '-'; } catch(e){}
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
        // 測定中のみ戦闘力を更新し、撮影後は値を固定する
        if (!measurementLocked && results && results.poseLandmarks) {
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
    // 新しい測定を開始するたびにロックと確定値をリセット
    measurementLocked = false;
    snapshotCombatStats = null;

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
        // 10秒経過時点の戦闘力(lastCombatStats)を、このタイミングで確定させる
        snapshotCombatStats = lastCombatStats ? { ...lastCombatStats } : null;
        measurementLocked = true; // 以降は戦闘力を更新しない

        // ★ 戦闘力を名前入力モーダルに表示
        const totalPowerEl = document.getElementById('modal-total-power');
        if (snapshotCombatStats && snapshotCombatStats.total_power) {
            totalPowerEl.textContent = snapshotCombatStats.total_power.toLocaleString();
        } else {
            totalPowerEl.textContent = '0';
        }
    } catch(e) {}

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
        // 保存成功時のプレビュー画像表示は廃止（名前入力時に画像を表示しない仕様）
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
    // 写真撮影タイミングで確定させた戦闘力を優先して使用する
    const currentStats = snapshotCombatStats || lastCombatStats || { total_power: POWER_CONSTANTS.baseline };
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