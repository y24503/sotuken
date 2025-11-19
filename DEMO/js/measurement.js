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
    baseline: 100000,
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
    // ランドマークが取得できていない場合は、基礎点のみを返す
    if (!lm || lm.length < 33) {
        return {
            base_power: 0, pose_bonus: 0, expression_bonus: 0, total_power: POWER_CONSTANTS.baseline,
            height: 0, reach: 0, shoulder: 0, expression: 0, pose: 0
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
    const top = lm[0]; // 頭頂
    const ankleL = lm[29]; // 左足首
    const ankleR = lm[30]; // 右足首
    const wristL = lm[15]; // 左手首
    const wristR = lm[16]; // 右手首
    const shoulderL = lm[11]; // 左肩
    const shoulderR = lm[12]; // 右肩
    const hipL = lm[23]; // 左腰
    const hipR = lm[24]; // 右腰

    // --- 1. 体格 (Base) の計算 ---
    // (各値はランドマークの座標(0〜1)に基づいているため、ピクセル単位ではない)
    const height = Math.abs(top.y - ((ankleL.y + ankleR.y) / 2)); // 身長 (頭頂〜足首のY差)
    const reach = v2(wristL, wristR); // リーチ (両手首の距離)
    const shoulder = v2(shoulderL, shoulderR); // 肩幅 (両肩の距離)
    const leg = v2(hipL, ankleL) + v2(hipR, ankleR); // 両足の長さ (腰〜足首)

    // 身長比に正規化 (0〜1の範囲)
    const eps = 1e-6; // ゼロ除算防止
    const h = Math.max(height, eps);
    const maxF = POWER_CONSTANTS.clipFeature; // 補正上限
    const rN = clip01((reach / h) / maxF); // 正規化リーチ
    const sN = clip01((shoulder / h) / maxF); // 正規化肩幅
    const lN = clip01(((leg / h) / 2) / maxF); // 正規化脚長

    // --- 2. スタイル (Style) の計算 ---
    const spineMid = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 }; // 背骨中央（腰）
    const poseVal = v2(top, spineMid); // ポーズ値（頭頂から腰の距離 = 背筋の伸び）
    const poseN = clip01(poseVal / 0.5); // 正規化ポーズ値
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
    const span = POWER_CONSTANTS.maxTotal - POWER_CONSTANTS.baseline;
    // 各ボーナス項目を計算
    let base_amount = span * POWER_CONSTANTS.weightBase * baseRaw;
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

    // 最終的なオブジェクトを返す
    return {
        base_power: Math.round(base_amount),
        pose_bonus: Math.round(pose_amount),
        expression_bonus: Math.round(expr_amount),
    // speed_bonus 削除
        total_power: total,
        height, reach, shoulder, expression: exprN, pose: poseN // 生データ（デバッグ表示用）
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
    try { statHeight.textContent = stats.height ? stats.height.toFixed(2) : '-'; } catch(e){}
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
            ctx.clearRect(0,0,canvasEl.width,canvasEl.height);
            if (videoEl && videoEl.videoWidth) {
                if (canvasEl.width !== videoEl.videoWidth) canvasEl.width = videoEl.videoWidth;
                if (canvasEl.height !== videoEl.videoHeight) canvasEl.height = videoEl.videoHeight;
                ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            }
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
    // 既に動いているビデオ描画ループ(videoRenderRAF)は停止
    if (videoRenderRAF) cancelAnimationFrame(videoRenderRAF);

    // 毎フレーム、ビデオ映像を MediaPipe Pose に送信するループ
    const run = async () => {
        try {
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
        return json;
    } catch (e) {
        alert('保存に失敗しました');
        return null;
    }
}

// --- 名前入力モーダルの処理 (OK / Cancel) ---

// OKボタン: 2P対戦フローの核心
btnNameOk && btnNameOk.addEventListener('click', async () => {
    const name = inputPlayerName.value.trim() || 'PLAYER'; // 名前を取得
    nameModal.classList.add('hidden'); // モーダルを閉じる

    // データをサーバーに保存（ランキング登録）
    const saveJson = await saveResultToDB(lastCombatStats || { total_power: POWER_CONSTANTS.baseline }, lastSnapshotDataUrl || '', name);

    // --- 2人測定モード (2pmeasure) の判定 ---
    let bs = {}; // battleState
    try { 
        // index.html から引き継いだ sessionStorage を読み込む
        bs = JSON.parse(sessionStorage.getItem('battleState') || '{}'); 
    } catch(e){}
    
    const q = getQueryParams(); // URLから ?player=1 などを取得
    const playerNum = q.player ? Number(q.player) : 1; // 自分がP1かP2か

    // 2P対戦モードの場合
    if (bs && bs.mode === '2pmeasure') {
        // サーバーに保存された画像パス (src/...) があればそれ、なければDataURL
        const savedImgPath = (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl;

        // --- P1 の測定が完了した場合 ---
        // (ステップが202 (P1測定中) AND 自分がP1)
        if (bs.step === 202 && playerNum === 1) {
            // P1のデータを battleState に保存
            bs.player1 = {
                name: name || 'PLAYER1',
                score: (lastCombatStats && lastCombatStats.total_power) || 0,
                image: savedImgPath
            };
            bs.step = 203; // ステップを「P2測定中」に進める
            // sessionStorage を更新
            sessionStorage.setItem('battleState', JSON.stringify(bs));
            
            // P2 の測定へ移動 (ページをリロードしてP2にする)
            window.location.href = 'measurement.html?player=2';
            return; // 処理終了
        }
        
        // --- P2 の測定が完了した場合 ---
        // (ステップが203 (P2測定中) AND 自分がP2)
        if (bs.step === 203 && playerNum === 2) {
            // P2のデータを battleState に保存
            bs.player2 = {
                name: name || 'PLAYER2',
                score: (lastCombatStats && lastCombatStats.total_power) || 0,
                image: (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl
            };
            bs.step = 204; // ステップを「両者測定完了」に進める
            // sessionStorage を更新
            sessionStorage.setItem('battleState', JSON.stringify(bs));
            
            // index.html に戻る (戻った先で index.html の復帰処理が走り、バトル画面が表示される)
            window.location.href = 'index.html';
            return; // 処理終了
        }
    
    } else {
        // 1P（単独）測定の場合: ランキングページへ遷移
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
    await openCamera(); // カメラ起動
    await startPoseLoop(); // ポーズ推定ループ開始
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