// エラー抑制システム
(function() {
    // デバッグモード設定
    window._debugMode = false;
    
    const suppressPatterns = [
        'chrome-extension://',
        'moz-extension://',
        'safari-extension://',
        'edge-extension://',
        'NotificationContent',
        'ERR_FILE_NOT_FOUND',
        'Device in use',
        'NotReadableError',
        'notification.json',
        'internalPages.json',
        'popup.json',
        'extension',
        'locales',
        'Failed to load extension',
        'ERR_UNKNOWN_URL_SCHEME',
        'Access-Control-Allow-Origin',
        'sound',
        'audio',
        'MediaElementAudioSource',
        'CORS',
        'net::ERR_FILE_NOT_FOUND',
        'NS_ERROR_FAILURE',
        'The request is not allowed by the user agent or the platform',
        'AbortError',
        'NetworkError',
        'favicon.ico',
        'Failed to load resource',
        'cdn.jsdelivr',
        'cdnjs',
        'googleapis',
        '404 (Not Found)',
        'WebSocket connection',
        'BlockingPageContent',
        'QuotaExceededError',
        'Storage quota exceeded',
        'LocalStorage is not available',
        'Tracking Prevention blocked',
        'coijogkijncjnjkcjjc', // 特定の拡張機能ID
        'GET chrome-extension',
        'GET moz-extension',
        'manifest.json',
        '_locales',
        'Content Security Policy'
    ];
    
    const originals = {
        error: console.error,
        warn: console.warn,
        info: console.info,
        log: console.log
    };
    
    const shouldSuppress = (message) => {
        // デバッグモードの場合はエラー抑制を無効化
        if (window._debugMode) return false;
        
        const str = String(message || '').toLowerCase();
        return suppressPatterns.some(pattern => str.includes(pattern.toLowerCase()));
    };
    
    ['error', 'warn', 'info', 'log'].forEach(method => {
        console[method] = function(...args) {
            const msg = args.join(' ');
            if (!shouldSuppress(msg)) {
                originals[method].apply(this, args);
            }
        };
    });
    
    window.addEventListener('error', (e) => {
        const src = e.filename || e.target?.src || e.target?.href || '';
        const msg = e.message || '';
        if (shouldSuppress(src) || shouldSuppress(msg)) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, true);
    
    window.addEventListener('unhandledrejection', (e) => {
        const reason = String(e.reason || '');
        if (shouldSuppress(reason)) {
            e.preventDefault();
            return false;
        }
    });
    
    // リソース読み込みエラーの抑制
    document.addEventListener('error', (e) => {
        const target = e.target;
        if (target && (target.src || target.href)) {
            const url = target.src || target.href;
            if (shouldSuppress(url)) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }
    }, true);
})();

// バトル進行用の状態
let battleState = {
    mode: null, // 'battle'のときバトル進行中
    step: 0,    // 0:未開始, 1:P1性別, 2:P1測定, 3:P1名前, 4:P2性別, 5:P2測定, 6:P2名前, ...
    player1: {},
    player2: {},
    // クリックバトル用
    clickBattle: {
        currentTurn: 1, // 1 or 2
        round: 1,       // 1-3
        p1Clicks: 0,
        p2Clicks: 0,
        timer: 10,
        timerInterval: null,
        isActive: false
    }
};
// 画面切り替えとボタンイベント再バインド
function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(sc => sc.classList.add('hidden'));
    const el = document.getElementById('screen-' + screenName);
    if (el) el.classList.remove('hidden');

    // 効果音を全ボタンに
    document.querySelectorAll('button, .btn, .hud-button').forEach(btn => {
        btn.onclick = null;
        btn.addEventListener('click', playButtonSE);
    });

    if (screenName === 'title') {
        const btnGotoInstructions = document.getElementById('btn-goto-instructions');
        if (btnGotoInstructions) btnGotoInstructions.onclick = () => showScreen('instructions');
        const btnGotoRanking = document.getElementById('btn-goto-ranking');
        if (btnGotoRanking) btnGotoRanking.onclick = async () => { showScreen('ranking'); await fetchAndShowRanking(); };
        const btnGoto2P = document.getElementById('btn-goto-2pmeasure');
        if (btnGoto2P) btnGoto2P.onclick = () => {
            console.log('2人測定ボタンクリック');
            showScreen('2pmeasure');
        };
        // バトルボタンは非表示または無効化
        const btnGotoBattleInfo = document.getElementById('btn-goto-battle-info');
        if (btnGotoBattleInfo) btnGotoBattleInfo.style.display = 'none';
    }
    if (screenName === '2pmeasure') {
        console.log('2pmeasure画面を表示');
        const btnStart = document.getElementById('btn-2pmeasure-start');
        const btnExit = document.getElementById('btn-2pmeasure-exit');
        const stage = document.getElementById('2pmeasure-stage');
        battleState.mode = '2pmeasure';
        battleState.step = 201;
        battleState.player1 = { name: '', battleIndex: 5000 };
        battleState.player2 = { name: '', battleIndex: 5000 };
        console.log('battleState初期化完了:', battleState);

        if (stage) stage.textContent = '1人目の測定を自動で開始します...';
        
        // 1秒後に自動でPlayer1の測定を開始
        setTimeout(() => {
            battleState.step = 202;
            if (stage) stage.textContent = 'PLAYER1 測定中...';
            showScreen('measurement');
            console.log('Player1測定を自動開始');
        }, 1000);
        
        if (btnExit) btnExit.onclick = () => showScreen('title');
    }
    if (screenName === 'instructions') {
        const btnBack = document.getElementById('btn-back-to-title-1');
        if (btnBack) btnBack.onclick = () => showScreen('title');
        const btnNext = document.getElementById('btn-goto-gender');
        if (btnNext) btnNext.onclick = () => showScreen('gender');
    }
    if (screenName === 'gender') {
        const btnBack = document.getElementById('btn-back-to-instructions');
        if (btnBack) btnBack.onclick = () => showScreen('instructions');
        document.querySelectorAll('.gender-btn').forEach(btn => {
            btn.onclick = () => {
                showScreen('measurement');
                startMeasurement();
            };
        });
    }
    if (screenName === 'measurement') {
        // カメラを初期化（バトルモードでも使用）
        initializeCamera();
        
        // Player情報を表示
        const measurementTitle = document.querySelector('.measurement-title');
        if (battleState.mode === '2pmeasure') {
            if (battleState.step === 202) {
                if (measurementTitle) measurementTitle.textContent = 'PLAYER1 測定';
            } else if (battleState.step === 204) {
                if (measurementTitle) measurementTitle.textContent = 'PLAYER2 測定';
            }
        }
        
        const btnStartMeasure = document.getElementById('btn-start-measure');
        if (btnStartMeasure) {
            // 対戦モードか通常モードかで処理を分ける
            if (battleState.mode === '2pmeasure') {
                btnStartMeasure.onclick = () => {
                    console.log('対戦モードでカメラ測定開始');
                    startCameraMeasurement();
                };
            } else {
                btnStartMeasure.onclick = () => {
                    console.log('通常モードでカメラ測定開始');
                    startCameraMeasurement();
                };
            }
        }
        const btnNameOk = document.getElementById('btn-name-ok');
        if (btnNameOk) btnNameOk.onclick = () => {
            document.getElementById('name-modal').classList.add('hidden');
            if (battleState.mode === '2pmeasure') {
                console.log('2pmeasureモードで名前入力完了, step:', battleState.step);
                const stats = window._latestCombatStats;
                const playerName = document.getElementById('input-player-name')?.value?.trim() || '';
                console.log('入力された名前:', playerName);
                console.log('測定データ:', stats);
                
                if (battleState.step === 202) {
                    battleState.player1.score = stats?.total_power || Math.floor(Math.random() * 10000 + 1000);
                    battleState.player1.name = playerName || 'PLAYER1';
                    battleState.step = 204; // 直接Player2の測定へ
                    console.log('Player1データ保存完了:', battleState.player1);
                    
                    // Player2の測定を開始
                    setTimeout(() => {
                        showScreen('measurement');
                        console.log('Player2の測定を開始');
                    }, 1000);
                } else if (battleState.step === 204) {
                    battleState.player2.score = stats?.total_power || Math.floor(Math.random() * 10000 + 1000);
                    battleState.player2.name = playerName || 'PLAYER2';
                    battleState.step = 301;
                    console.log('Player2データ保存完了:', battleState.player2);
                    console.log('クリックバトルへ遷移');
                    
                    // クリックバトル開始
                    setTimeout(() => {
                        showScreen('click-battle');
                        setupClickBattle();
                    }, 1000);
                }
            } else {
                // 通常測定の場合
                const name = document.getElementById('input-player-name')?.value?.trim() || 'PLAYER';
                saveResultToDB(window._latestCombatStats, lastSnapshotDataUrl, name).then(saveResult => {
                    if (saveResult?.server) {
                        console.log('サーバーに保存されました');
                    } else if (saveResult?.local) {
                        console.log('ローカルストレージに保存されました');
                    }
                    
                    showScreen('ranking');
                    fetchAndShowRanking();
                });
            }
        };
    }
    if (screenName === 'typing-battle') {
        const typingStage = document.getElementById('typing-stage');
        const typingInput = document.getElementById('typing-input');
        const typingPrompt = document.getElementById('typing-prompt');
        const btnNextRound = document.getElementById('btn-next-round');
        const btnExitBattle = document.getElementById('btn-exit-battle');

        if (btnNextRound) btnNextRound.onclick = () => startTypingRound();
        if (btnExitBattle) btnExitBattle.onclick = () => showScreen('title');

        startTypingRound();
    }
    if (screenName === 'click-battle') {
        setupClickBattle();
    }
    const btnNameCancel = document.getElementById('btn-name-cancel');
    if (btnNameCancel) btnNameCancel.onclick = () => {
        document.getElementById('name-modal').classList.add('hidden');
    };
    if (screenName === 'ranking') {
        const btnBack = document.getElementById('btn-back-to-title-3');
        if (btnBack) btnBack.onclick = () => showScreen('title');
        
        const btnDeleteSelected = document.getElementById('btn-delete-selected');
        if (btnDeleteSelected) {
            btnDeleteSelected.onclick = () => deleteSelectedRankingData();
        }
        
        const btnClearAll = document.getElementById('btn-clear-all-data');
        if (btnClearAll) {
            btnClearAll.onclick = () => clearAllRankingData();
        }
    }
}

// 初期画面表示とボタンイベント再バインド
window.addEventListener('DOMContentLoaded', () => {
    showScreen('title');
});

function startTypingBattle() {
    battleState.mode = 'typing';
    battleState.round = 1;
    battleState.player1.time = 0;
    battleState.player2.time = 0;
    startTypingRound();
}

function startTypingRound() {
    const currentPlayer = battleState.round % 2 === 1 ? 'player1' : 'player2';
    const typingPrompt = document.getElementById('typing-prompt');
    const typingInput = document.getElementById('typing-input');

    if (!typingPrompt || !typingInput) {
        console.error('Typing elements not found. Ensure #typing-prompt and #typing-input exist.');
        return;
    }

    const promptText = generateTypingPrompt();
    typingPrompt.textContent = promptText;
    typingInput.value = '';
    typingInput.disabled = false;
    typingInput.focus();

    const startTime = Date.now();
    typingInput.oninput = () => {
        if (typingInput.value === promptText) {
            const elapsedTime = Date.now() - startTime;
            battleState[currentPlayer].time += elapsedTime;

            typingInput.disabled = true;
            battleState.round++;
            if (battleState.round > 6) {
                resolveTypingBattle();
            } else {
                startTypingRound();
            }
        }
    };
}

function resolveTypingBattle() {
    const p1Time = battleState.player1.time;
    const p2Time = battleState.player2.time;

    let winner = '';
    if (p1Time < p2Time) {
        winner = 'PLAYER1';
    } else if (p1Time > p2Time) {
        winner = 'PLAYER2';
    } else {
        winner = 'DRAW';
    }

    // タイピングバトル結果を保存
    battleState.typingWinner = winner;
    
    alert(`タイピングバトル結果: ${winner}の勝利！`);
    
    // クリックバトルに遷移
    showScreen('click-battle');
}

function generateTypingPrompt() {
    const prompts = ['戦闘力', 'タイピング', 'バトル', 'スピード', '勝利'];
    return prompts[Math.floor(Math.random() * prompts.length)];
}

let measureTimeout = null;
let lastSnapshotDataUrl = null;
let lastCombatStats = null;

document.addEventListener('DOMContentLoaded', () => {
    const btnStartMeasure = document.getElementById('btn-start-measure');
    const nameModal = document.getElementById('name-modal');
    const inputPlayerName = document.getElementById('input-player-name');
    const btnNameOk = document.getElementById('btn-name-ok');
    const btnNameCancel = document.getElementById('btn-name-cancel');
    if (btnStartMeasure) {
        btnStartMeasure.addEventListener('click', async () => {
            btnStartMeasure.disabled = true;
            btnStartMeasure.textContent = 'MEASURING...';

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

            measureTimeout = setTimeout(async () => {
                const canvas = measurementElements?.canvas;
                let dataUrl = null;
                
                // Canvasから画像データを取得
                if (canvas && canvas.width > 0 && canvas.height > 0) {
                    try {
                        dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                        console.log('画像データ取得成功:', dataUrl.length, 'bytes');
                    } catch (e) {
                        console.warn('Canvas画像取得失敗:', e);
                        // フォールバック: ダミー画像データ
                        dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
                    }
                }
                
                lastSnapshotDataUrl = dataUrl;
                lastCombatStats = window._latestCombatStats || {};
                inputPlayerName.value = '';
                nameModal.classList.remove('hidden');
                inputPlayerName.focus();
                
                // プレビュー画像を設定
                const preview = document.getElementById('save-preview');
                if (preview && dataUrl) {
                    preview.src = dataUrl;
                    preview.style.display = 'block';
                }
            }, 10000);
        });
    }

    if (btnNameOk) {
        btnNameOk.addEventListener('click', async () => {
            const name = inputPlayerName.value.trim() || 'PLAYER';
            nameModal.classList.add('hidden');
            
            const saveResult = await saveResultToDB(lastCombatStats, lastSnapshotDataUrl, name);
            
            btnStartMeasure.disabled = false;
            btnStartMeasure.textContent = 'START';
            
            // 保存結果に応じてメッセージ表示
            if (saveResult?.server) {
                console.log('サーバーに保存されました');
            } else if (saveResult?.local) {
                console.log('ローカルストレージに保存されました');
            }
            
            showScreen('ranking');
            await fetchAndShowRanking();
        });
    }
    if (btnNameCancel) {
        btnNameCancel.addEventListener('click', () => {
            nameModal.classList.add('hidden');
            btnStartMeasure.disabled = false;
            btnStartMeasure.textContent = 'START';
        });
    }
    if (buttons.backToTitle2) {
        buttons.backToTitle2.addEventListener('click', () => {
            stopMeasurement();
            showScreen('title');
            if (measureTimeout) { clearTimeout(measureTimeout); measureTimeout = null; }
            if (btnStartMeasure) {
                btnStartMeasure.disabled = false;
                btnStartMeasure.textContent = 'START';
            }
        });
    }
    document.querySelectorAll('button, .btn, .hud-button').forEach(btn => {
        btn.addEventListener('click', playButtonSE);
    });

    const btnGotoRanking = document.getElementById('btn-goto-ranking');
    if (btnGotoRanking) {
        btnGotoRanking.addEventListener('click', async () => {
            showScreen('ranking');
            await fetchAndShowRanking();
        });
    }
    const btnBackToTitle3 = document.getElementById('btn-back-to-title-3');
    if (btnBackToTitle3) {
        btnBackToTitle3.addEventListener('click', () => {
            showScreen('title');
        });
    }

    const btnClearData = document.getElementById('btn-clear-data');
    if (btnClearData) {
        btnClearData.addEventListener('click', () => {
            if (confirm('保存されたデータをすべて削除しますか？この操作は元に戻せません。')) {
                try {
                    if (typeof(Storage) !== "undefined" && window.localStorage) {
                        localStorage.clear(); // ローカルストレージをクリア
                        console.log('ローカルストレージクリア完了');
                    }
                } catch (e) {
                    console.error('ローカルストレージクリアエラー:', e.message);
                }
                alert('データを削除しました。');
                fetchAndShowRanking(); // ランキングを再取得
            }
        });
    }

    const btnDeleteSelected = document.getElementById('btn-delete-selected');
    if (btnDeleteSelected) {
        btnDeleteSelected.addEventListener('click', async () => {
            const selectedCheckboxes = document.querySelectorAll('.ranking-checkbox:checked');
            if (selectedCheckboxes.length === 0) {
                alert('削除するデータを選択してください。');
                return;
            }

            if (confirm('選択したデータを削除しますか？この操作は元に戻せません。')) {
                const idsToDelete = Array.from(selectedCheckboxes).map(cb => cb.dataset.id);
                try {
                    const res = await fetch('http://localhost:3001/api/delete_scores', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: idsToDelete })
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert('選択したデータを削除しました。');
                        fetchAndShowRanking(); // 削除後にランキングを再取得
                    } else {
                        alert('データの削除に失敗しました。');
                    }
                } catch (e) {
                    alert('エラーが発生しました。');
                }
            }
        });
    }
});

// 画像表示用のヘルパー関数
function generateImageHtml(row, dataSource, index) {
    const defaultIcon = `<div style="width:64px;height:48px;background:#071116;border-radius:6px;display:flex;align-items:center;justify-content:center;"><span style="font-size:24px;">⚔️</span></div>`;
    
    if (!row.image) {
        return defaultIcon;
    }
    
    // Base64画像の場合（ローカルストレージ）
    if (row.image.startsWith('data:')) {
        return `<img src="${row.image}" alt="thumb" style="width:64px;height:48px;object-fit:cover;border-radius:6px;" onerror="this.parentNode.innerHTML='${defaultIcon.replace(/'/g, "&apos;")}'">`;
    }
    
    // ファイルパス画像の場合（Node.js API）
    if (dataSource === 'api' && row.image) {
        return `<img src="http://localhost:3001/src/${row.image}" alt="thumb" style="width:64px;height:48px;object-fit:cover;border-radius:6px;" onerror="this.parentNode.innerHTML='${defaultIcon.replace(/'/g, "&apos;")}'">`;
    }
    
    return defaultIcon;
}

async function fetchAndShowRanking() {
    const rankingList = document.getElementById('ranking-list');
    if (!rankingList) return;
    rankingList.innerHTML = '<div class="text-center text-gray-400">Loading...</div>';
    
    let data = [];
    let dataSource = 'none';
    
    // Node.js API接続を試行
    try {
        const res = await fetch('http://localhost:3001/api/get_ranking');
        if (res.ok) {
            const apiData = await res.json();
            if (Array.isArray(apiData) && apiData.length > 0) {
                data = apiData;
                dataSource = 'api';
            }
        }
    } catch (e) {
        console.warn('Node.js API接続失敗:', e.message);
    }
    
    // API失敗時はローカルストレージから取得
    if (data.length === 0) {
        try {
            if (typeof(Storage) !== "undefined" && window.localStorage) {
                const localData = JSON.parse(localStorage.getItem('battleIndexRanking') || '[]');
                if (localData.length > 0) {
                    data = localData.sort((a, b) => (b.score || 0) - (a.score || 0));
                    dataSource = 'local';
                }
            } else {
                console.warn('LocalStorageが使用できません');
            }
        } catch (e) {
            console.error('ローカルストレージ読み取り失敗:', e.message);
        }
    }
    
    if (data.length > 0) {
        // データソース表示
        const sourceLabel = dataSource === 'api' ? '' : '<div class="text-xs text-yellow-300 text-center mb-2">📱 ローカルデータ表示中</div>';
        
        rankingList.innerHTML = sourceLabel + data.slice(0, 20).map((row, i) =>
            `<div class="flex items-center gap-4 p-2 bg-gray-800 rounded-lg">
                <input type="checkbox" class="ranking-checkbox" data-id="${row.id}">
                <span class="text-2xl font-bold text-cyan-400 w-8 text-center">${i + 1}</span>
                ${generateImageHtml(row, dataSource, i)}
                <div class="flex-1">
                    <span class="font-orbitron text-lg block">${row.name || 'PLAYER'}</span>
                    ${row.timestamp ? `<span class="text-xs text-gray-400">${new Date(row.timestamp).toLocaleDateString()}</span>` : ''}
                </div>
                <span class="font-mono text-xl text-yellow-300">${(row.score || 0).toLocaleString()}</span>
            </div>`
        ).join('');
    } else {
        rankingList.innerHTML = '<div class="text-center text-gray-400">まだデータがありません<br><small>測定を行ってランキングに登録しよう！</small></div>';
    }
}

// 戦闘力数値安定化関数
function stabilizeCombatStats(newStats) {
    // 履歴に追加
    combatStatsHistory.push(newStats);
    if (combatStatsHistory.length > STATS_HISTORY_SIZE) {
        combatStatsHistory.shift();
    }
    
    // 異常値検出と除去
    const cleanedStats = removeOutliers(combatStatsHistory);
    
    // 移動平均を計算
    const smoothedStats = calculateMovingAverage(cleanedStats);
    
    // 段階的変化を適用
    const stabilizedStats = applyGradualChange(smoothedStats);
    
    return stabilizedStats;
}

// 異常値除去関数
function removeOutliers(statsArray) {
    if (statsArray.length < 3) return statsArray;
    
    const totalPowers = statsArray.map(s => s.total_power);
    const mean = totalPowers.reduce((sum, val) => sum + val, 0) / totalPowers.length;
    const stdDev = Math.sqrt(totalPowers.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / totalPowers.length);
    
    // 標準偏差の2倍を超える値は除外
    return statsArray.filter(stats => {
        const deviation = Math.abs(stats.total_power - mean);
        return deviation <= stdDev * 2;
    });
}

// 移動平均計算関数
function calculateMovingAverage(statsArray) {
    if (statsArray.length === 0) return null;
    
    const avgStats = {
        total_power: 0,
        base_power: 0,
        pose_bonus: 0,
        expression_bonus: 0,
        speed_bonus: 0,
        height: 0,
        reach: 0,
        shoulder: 0,
        expression: 0,
        pose: 0
    };
    
    // 各値の平均を計算
    statsArray.forEach(stats => {
        Object.keys(avgStats).forEach(key => {
            if (stats[key] !== undefined) {
                avgStats[key] += stats[key];
            }
        });
    });
    
    Object.keys(avgStats).forEach(key => {
        avgStats[key] = avgStats[key] / statsArray.length;
    });
    
    return avgStats;
}

// 段階的変化適用関数
function applyGradualChange(newStats) {
    if (!lastStableCombatStats || !newStats) {
        lastStableCombatStats = newStats;
        return newStats;
    }
    
    const gradualStats = { ...newStats };
    
    // 各値に対して段階的変化を適用
    Object.keys(gradualStats).forEach(key => {
        if (typeof gradualStats[key] === 'number' && lastStableCombatStats[key] !== undefined) {
            const currentValue = lastStableCombatStats[key];
            const targetValue = newStats[key];
            const difference = targetValue - currentValue;
            
            // 変化率を制限
            const maxChange = Math.abs(currentValue * MAX_CHANGE_RATE);
            const limitedChange = Math.sign(difference) * Math.min(Math.abs(difference), maxChange);
            
            gradualStats[key] = currentValue + limitedChange;
        }
    });
    
    lastStableCombatStats = gradualStats;
    return gradualStats;
}

function updateStats(combat_stats) {
    // 数値を安定化
    const stabilizedStats = stabilizeCombatStats(combat_stats);
    
    if (!stabilizedStats) {
        return; // 安定化処理失敗時は更新しない
    }
    
    window._latestCombatStats = stabilizedStats;
    const totalPower = Math.round(stabilizedStats.total_power);
    
    if (totalPower > maxBattleIndex) { maxBattleIndex = totalPower; }
    
    // UIに安定化された値を表示
    measurementElements.totalPower.textContent = totalPower.toLocaleString();
    measurementElements.basePower.textContent = Math.round(stabilizedStats.base_power).toLocaleString();
    measurementElements.poseBonus.textContent = `+${Math.round(stabilizedStats.pose_bonus).toLocaleString()}`;
    measurementElements.expressionBonus.textContent = `+${Math.round(stabilizedStats.expression_bonus).toLocaleString()}`;
    measurementElements.speedBonus.textContent = `+${Math.round(stabilizedStats.speed_bonus).toLocaleString()}`;
    measurementElements.statHeight.textContent = stabilizedStats.height ? stabilizedStats.height.toFixed(3) : '-';
    measurementElements.statReach.textContent = stabilizedStats.reach ? stabilizedStats.reach.toFixed(3) : '-';
    measurementElements.statShoulder.textContent = stabilizedStats.shoulder ? stabilizedStats.shoulder.toFixed(3) : '-';
    measurementElements.statExpression.textContent = stabilizedStats.expression ? stabilizedStats.expression.toFixed(3) : '-';
    measurementElements.statPose.textContent = stabilizedStats.pose ? stabilizedStats.pose.toFixed(3) : '-';
}

async function saveResultToDB(combatStats, imageDataUrl, name = 'PLAYER') {
    const scoreData = {
        name: name,
        score: combatStats?.total_power || 0,
        image: imageDataUrl,
        timestamp: Date.now(),
        stats: combatStats
    };
    
    try {
        const res = await fetch('http://localhost:3001/api/save_score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save_score',
                ...scoreData
            })
        });
        
        if (!res.ok) throw new Error('Server response not ok');
        
        const json = await res.json();
        if (json && json.success) {
            if (json.image) {
                try {
                    const preview = document.getElementById('save-preview');
                    if (preview) {
                        preview.src = `http://localhost:3001/src/${json.image}`;
                        preview.style.display = 'block';
                    }
                } catch(e){
                    console.warn('プレビュー画像更新失敗:', e);
                }
            }
            // API成功時もローカルストレージにバックアップ保存
            const localData = { ...scoreData, image: json.image || scoreData.image };
            saveToLocalStorage(localData);
            return { success: true, server: true };
        } else {
            throw new Error('Server returned error');
        }
    } catch (e) {
        console.warn('Node.js API保存失敗、ローカルストレージに保存:', e.message);
        // API失敗時はローカルストレージに保存
        saveToLocalStorage(scoreData);
        return { success: true, local: true };
    }
}

// ローカルストレージ保存機能
function saveToLocalStorage(scoreData) {
    try {
        // LocalStorageが使用可能かチェック
        if (typeof(Storage) === "undefined" || !window.localStorage) {
            console.warn('LocalStorageがサポートされていません');
            return false;
        }
        
        const existingData = JSON.parse(localStorage.getItem('battleIndexRanking') || '[]');
        const newEntry = {
            id: Date.now(),
            ...scoreData,
            // 画像データを保持（Base64またはファイルパス）
            image: scoreData.image || null
        };
        existingData.push(newEntry);
        
        // 最新100件のみ保持
        if (existingData.length > 100) {
            existingData.splice(0, existingData.length - 100);
        }
        
        localStorage.setItem('battleIndexRanking', JSON.stringify(existingData));
        console.log('ローカルストレージに保存成功');
        return true;
    } catch (e) {
        console.error('ローカルストレージ保存失敗:', e.message);
        return false;
    }
}

const seButton = document.getElementById('se-button');
function playButtonSE() {
    try {
        if (seButton) {
            seButton.currentTime = 0;
            const playPromise = seButton.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    // 音声再生エラーを静かに処理
                });
            }
        }
    } catch (error) {
        // エラーを静かに処理
    }
}

const screens = {
    title: document.getElementById('screen-title'),
    instructions: document.getElementById('screen-instructions'),
    gender: document.getElementById('screen-gender'),
    measurement: document.getElementById('screen-measurement'),
    ranking: document.getElementById('screen-ranking')
};
const buttons = {
    genderBtns: document.querySelectorAll('.gender-btn'),
    backToTitle2: document.getElementById('btn-back-to-title-2'),
    gotoInstructions: document.getElementById('btn-goto-instructions'),
    gotoGender: document.getElementById('btn-goto-gender'),
    backToTitle1: document.getElementById('btn-back-to-title-1'),
    backToInstructions: document.getElementById('btn-back-to-instructions')
};
const measurementElements = {
    video: document.getElementById('input-video'),
    canvas: document.getElementById('output-canvas'),
    socketStatus: document.getElementById('socket-status'),
    totalPower: document.getElementById('total-power'),
    basePower: document.getElementById('base-power'),
    poseBonus: document.getElementById('pose-bonus'),
    expressionBonus: document.getElementById('expression-bonus'),
    speedBonus: document.getElementById('speed-bonus'),
    statHeight: document.getElementById('stat-height'),
    statReach: document.getElementById('stat-reach'),
    statShoulder: document.getElementById('stat-shoulder'),
    statExpression: document.getElementById('stat-expression'),
    statPose: document.getElementById('stat-pose')
};

let socket = null, videoStream = null, sendInterval = null, maxBattleIndex = 0;
let mpCamera = null;

const canvasCtx = measurementElements.canvas.getContext('2d');
const receivedImage = new Image();

let pose = null;
let lastPoseResults = null;

let useClientLandmark = true;
let videoRenderRAF = null;

// 戦闘力安定化システム
let combatStatsHistory = [];
let lastStableCombatStats = null;
const STATS_HISTORY_SIZE = 10; // 移動平均のサンプル数
const STABILITY_THRESHOLD = 0.15; // 15%以内の変化は安定とみなす
const MAX_CHANGE_RATE = 0.25; // 1回の更新での最大変化率

var POSE_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,7],
    [0,4],[4,5],[5,6],[6,8],
    [9,10],
    [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
    [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32]
];

function drawLandmarksOnCanvas(results) {
    try { console.log('drawLandmarksOnCanvas called', !!results); } catch(e){}
    canvasCtx.clearRect(0, 0, measurementElements.canvas.width, measurementElements.canvas.height);
    try {
        const w = measurementElements.canvas.width;
        const h = measurementElements.canvas.height;
        canvasCtx.drawImage(measurementElements.video, 0, 0, w, h);
    } catch (e) {}
    if (results && results.poseLandmarks) {
        try { measurementElements.socketStatus.textContent = 'DETECTED'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
        window.drawConnectors(
            canvasCtx,
            results.poseLandmarks,
            (typeof window.POSE_CONNECTIONS !== 'undefined' ? window.POSE_CONNECTIONS : POSE_CONNECTIONS),
            {color: '#00FF41', lineWidth: 6}
        );
        window.drawLandmarks(canvasCtx, results.poseLandmarks, {
            color: '#00FF41',
            lineWidth: 0,
            radius: 10
        });
        window.drawLandmarks(canvasCtx, results.poseLandmarks, {
            color: '#000000',
            lineWidth: 2,
            radius: 10
        });
    }
}

function stopMeasurement() {
    if (sendInterval) { clearInterval(sendInterval); sendInterval = null; }
    if (socket) { socket.close(); socket = null; }
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    measurementElements.video.srcObject = null;
    try { measurementElements.video.style.display = ''; } catch(e) {}
    if (videoRenderRAF) { cancelAnimationFrame(videoRenderRAF); videoRenderRAF = null; }
    if (mpCamera) { try { mpCamera.stop(); } catch(e){} mpCamera = null; }
    if (pose) { pose.close(); pose = null; }
    
    // 安定化システムをリセット
    combatStatsHistory = [];
    lastStableCombatStats = null;
}

// 対戦用の簡易測定機能
function startSimpleMeasurement() {
    console.log('簡易測定開始');
    
    // 測定ボタンを無効化
    const btnStartMeasure = document.getElementById('btn-start-measure');
    if (btnStartMeasure) {
        btnStartMeasure.disabled = true;
        btnStartMeasure.textContent = '測定中...';
    }
    
    // 3秒間の測定シミュレーション
    setTimeout(() => {
        // ランダムスコア生成
        const mockScore = Math.floor(Math.random() * 8000 + 2000);
        window._latestCombatStats = {
            total_power: mockScore,
            punch_power: Math.floor(mockScore * 0.3),
            kick_power: Math.floor(mockScore * 0.4),
            speed_power: Math.floor(mockScore * 0.3)
        };
        
        console.log('測定完了:', window._latestCombatStats);
        
        // 測定ボタンをリセット
        if (btnStartMeasure) {
            btnStartMeasure.disabled = false;
            btnStartMeasure.textContent = '測定完了！';
        }
        
        // 名前入力モーダルを表示
        document.getElementById('name-modal').classList.remove('hidden');
    }, 3000);
}

// カメラ初期化関数
function initializeCamera() {
    console.log('カメラ初期化開始');
    const videoElement = document.getElementById('input_video');
    if (videoElement) {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                videoElement.srcObject = stream;
                videoElement.play();
                console.log('カメラアクセス成功');
            })
            .catch(error => {
                console.error('カメラアクセスエラー:', error);
            });
    }
}

// カメラを使用した測定関数
function startCameraMeasurement() {
    console.log('カメラ測定開始');
    
    // 測定ボタンを無効化
    const btnStartMeasure = document.getElementById('btn-start-measure');
    if (btnStartMeasure) {
        btnStartMeasure.disabled = true;
        btnStartMeasure.textContent = 'MEASURING...';
    }
    
    // MediaPipeを使用した実際の測定を開始
    if (battleState.mode === '2pmeasure') {
        // バトルモードでもMediaPipeを使用
        startMeasurement();
    } else {
        // 通常モードでもMediaPipeを使用
        startMeasurement();
    }
}

async function startMeasurement() {
    maxBattleIndex = 0;
    let socketError = false;
    try { 
        measurementElements.socketStatus.textContent = 'INIT'; 
        measurementElements.socketStatus.className = 'text-yellow-400'; 
    } catch(e){}
    
    // WebSocket接続のサイレント試行
    try {
        const checkConnection = () => {
            return new Promise((resolve, reject) => {
                try {
                    const testSocket = new WebSocket('ws://localhost:8765');
                    const timeout = setTimeout(() => {
                        testSocket.close();
                        reject(new Error('Connection timeout'));
                    }, 1500);
                    
                    testSocket.onopen = () => {
                        clearTimeout(timeout);
                        testSocket.close();
                        resolve(true);
                    };
                    
                    testSocket.onerror = () => {
                        clearTimeout(timeout);
                        reject(new Error('Connection failed'));
                    };
                } catch (e) {
                    reject(e);
                }
            });
        };
        
        try {
            await checkConnection();
            socket = new WebSocket('ws://localhost:8765');
        } catch (e) {
            throw new Error('WebSocket unavailable');
        }
        
        socket.onopen = () => {
            measurementElements.socketStatus.textContent = 'SCANNING';
            measurementElements.socketStatus.className = 'text-green-400';
        };
        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (!useClientLandmark) {
                    receivedImage.src = data.image;
                }
                updateStats(data.combat_stats);
            } catch(e) {
                // メッセージ解析エラーは静かに処理
            }
        };
        socket.onclose = () => {
            measurementElements.socketStatus.textContent = 'OFFLINE MODE';
            measurementElements.socketStatus.className = 'text-yellow-400';
        };
        socket.onerror = () => {
            socketError = true;
            measurementElements.socketStatus.textContent = 'OFFLINE MODE';
            measurementElements.socketStatus.className = 'text-yellow-400';
        };
        receivedImage.onload = () => {
            if (!useClientLandmark) {
                canvasCtx.clearRect(0, 0, measurementElements.canvas.width, measurementElements.canvas.height);
                canvasCtx.drawImage(receivedImage, 0, 0, measurementElements.canvas.width, measurementElements.canvas.height);
                try { measurementElements.socketStatus.textContent = 'SERVER IMAGE'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
            }
        };
    } catch (e) {
        socketError = true;
        measurementElements.socketStatus.textContent = 'OFFLINE MODE';
        measurementElements.socketStatus.className = 'text-yellow-400';
    }
    
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        measurementElements.video.srcObject = videoStream;
        try { measurementElements.socketStatus.textContent = 'VIDEO READY'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}

        await new Promise(resolve => {
            if (measurementElements.video.readyState >= 2) return resolve();
            measurementElements.video.onloadedmetadata = resolve;
        });
        try { measurementElements.video.style.display = 'none'; } catch(e) {}
        const vw = measurementElements.video.videoWidth;
        const vh = measurementElements.video.videoHeight;
        measurementElements.canvas.width = vw;
        measurementElements.canvas.height = vh;
        measurementElements.canvas.style.width = '100%';
        measurementElements.canvas.style.height = '100%';

        if (useClientLandmark && window.Pose) {
            pose = new window.Pose({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/${file}`
            });
            pose.setOptions({
                modelComplexity: 2,
                smoothLandmarks: true,
                enableSegmentation: false,
                minDetectionConfidence: 0.7,
                minTrackingConfidence: 0.7,
                smoothSegmentation: true
            });
            pose.onResults((results) => {
                lastPoseResults = results;
                drawLandmarksOnCanvas(results);
                
                // バトル状態で測定中の場合、MediaPipe値で戦闘力計算
                if (battleState.isActive && results && results.poseLandmarks) {
                    if (battleState.currentPhase === 'measuring_p1') {
                        console.log('Player 1: MediaPipe値で戦闘力計算中...');
                        const combat_stats = calculateCombatPowerFromLandmarks(results.poseLandmarks);
                        battleState.player1_stats = combat_stats;
                        
                        // 表示更新
                        try {
                            document.getElementById('player1-stats').style.display = 'block';
                            document.getElementById('player1-combat-power').textContent = combat_stats.total_power;
                        } catch(e) { console.log('Player1表示更新エラー:', e); }
                        
                    } else if (battleState.currentPhase === 'measuring_p2') {
                        console.log('Player 2: MediaPipe値で戦闘力計算中...');
                        const combat_stats = calculateCombatPowerFromLandmarks(results.poseLandmarks);
                        battleState.player2_stats = combat_stats;
                        
                        // 表示更新
                        try {
                            document.getElementById('player2-stats').style.display = 'block';
                            document.getElementById('player2-combat-power').textContent = combat_stats.total_power;
                        } catch(e) { console.log('Player2表示更新エラー:', e); }
                    }
                }
            });
            try { measurementElements.socketStatus.textContent = 'POSE READY'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}

            if (window.Camera) {
                try {
                    if (mpCamera) { mpCamera.stop(); mpCamera = null; }
                    mpCamera = new window.Camera(measurementElements.video, {
                        onFrame: async () => { 
                            if (pose) {
                                await pose.send({image: measurementElements.video}); 
                            }
                        },
                        width: measurementElements.canvas.width,
                        height: measurementElements.canvas.height
                    });
                    mpCamera.start();
                    try { measurementElements.socketStatus.textContent = 'MP CAMERA'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
                } catch (e) {
                    async function detectFrame() {
                        if (!pose || !measurementElements.video) return;
                        try {
                            await pose.send({image: measurementElements.video});
                        } catch(e) {
                            // ポーズ検出エラーは無視
                        }
                        requestAnimationFrame(detectFrame);
                    }
                    detectFrame();
                }
            } else {
                async function detectFrame() {
                    if (!pose || !measurementElements.video) return;
                    try {
                        await pose.send({image: measurementElements.video});
                    } catch(e) {
                        // ポーズ検出エラーは無視
                    }
                    requestAnimationFrame(detectFrame);
                }
                detectFrame();
            }
        }

        if (!(useClientLandmark && window.Pose)) {
            function renderVideoLoop() {
                try {
                    const w = measurementElements.canvas.width;
                    const h = measurementElements.canvas.height;
                    const ctx = measurementElements.canvas.getContext('2d');
                    ctx.clearRect(0, 0, w, h);
                    ctx.drawImage(measurementElements.video, 0, 0, w, h);

                    if (lastPoseResults && lastPoseResults.poseLandmarks) {
                        try {
                            window.drawConnectors(
                                ctx,
                                lastPoseResults.poseLandmarks,
                                (typeof window.POSE_CONNECTIONS !== 'undefined' ? window.POSE_CONNECTIONS : POSE_CONNECTIONS),
                                {color: '#00FF41', lineWidth: 6}
                            );
                            window.drawLandmarks(ctx, lastPoseResults.poseLandmarks, { color: '#00FF41', lineWidth: 0, radius: 10 });
                            window.drawLandmarks(ctx, lastPoseResults.poseLandmarks, { color: '#000000', lineWidth: 2, radius: 10 });
                            try { measurementElements.socketStatus.textContent = 'DETECTED'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
                        } catch(e) {}
                    } else {
                        try { measurementElements.socketStatus.textContent = 'VIDEO RENDER'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}
                    }
                } catch (e) {}
                videoRenderRAF = requestAnimationFrame(renderVideoLoop);
            }
            if (!videoRenderRAF) videoRenderRAF = requestAnimationFrame(renderVideoLoop);
        }

        if (!socketError && socket && socket.readyState === WebSocket.OPEN) {
            sendInterval = setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) {
                    try {
                        socket.send(getVideoFrame());
                    } catch(e) {
                        // WebSocket送信エラーは無視
                    }
                }
            }, 1000 / 30);
        } else {
            // オフラインモード用のダミーデータ送信
            sendInterval = setInterval(() => {
                generateOfflineStats();
            }, 500);
            generateOfflineStats(); // 初回データをすぐに生成
        }
    } catch (err) {
        measurementElements.socketStatus.textContent = 'CAMERA ERROR';
        measurementElements.socketStatus.className = 'text-red-500';
        console.error('Camera error:', err.message);
    }
}

// MediaPipeから得られた実際の値を使用して戦闘力を計算
function calculateCombatPowerFromLandmarks(landmarks) {
    if (!landmarks || landmarks.length < 33) {
        console.log('MediaPipeランドマークが不十分、ランダム値を使用');
        return generateRandomCombatStats();
    }
    
    try {
        // 1. 身長: 頭頂(0)と両足首(29,30)のy座標差
        const height = Math.abs(landmarks[0].y - (landmarks[29].y + landmarks[30].y) / 2);
        
        // 2. リーチ: 両手首(15,16)の距離
        const reach = Math.sqrt(
            Math.pow(landmarks[15].x - landmarks[16].x, 2) + 
            Math.pow(landmarks[15].y - landmarks[16].y, 2)
        );
        
        // 3. 肩幅: 両肩(11,12)の距離
        const shoulder = Math.sqrt(
            Math.pow(landmarks[11].x - landmarks[12].x, 2) + 
            Math.pow(landmarks[11].y - landmarks[12].y, 2)
        );
        
        // 4. 姿勢: 背骨(24,23)と首(0)の直線距離（体の直立度合い）
        const spine_center_x = (landmarks[23].x + landmarks[24].x) / 2;
        const spine_center_y = (landmarks[23].y + landmarks[24].y) / 2;
        const pose = Math.sqrt(
            Math.pow(landmarks[0].x - spine_center_x, 2) + 
            Math.pow(landmarks[0].y - spine_center_y, 2)
        );
        
        // 5. 表情: 顔のランドマーク(0,1,2,3,4)の分散（仮の指標）
        const face_points = [landmarks[0], landmarks[1], landmarks[2], landmarks[3], landmarks[4]];
        const face_x_coords = face_points.map(p => p.x);
        const face_y_coords = face_points.map(p => p.y);
        const face_variance_x = calculateVariance(face_x_coords);
        const face_variance_y = calculateVariance(face_y_coords);
        const expression = Math.sqrt(face_variance_x + face_variance_y);
        
        // 戦闘力計算（server.pyと同じ係数を使用）
        const height_score = height * 100000;
        const reach_score = reach * 150000;
        const shoulder_score = shoulder * 80000;
        const pose_bonus = pose * 50000;
        const expression_bonus = expression * 30000;
        const speed_bonus = 0; // スピードボーナスは別途計算
        
        const base_power = height_score + reach_score + shoulder_score;
        const total_power = base_power + pose_bonus + expression_bonus + speed_bonus;
        
        console.log('MediaPipe実測値で計算:', {
            height, reach, shoulder, pose, expression,
            height_score, reach_score, shoulder_score, pose_bonus, expression_bonus, total_power
        });
        
        return {
            base_power: Math.round(base_power),
            pose_bonus: Math.round(pose_bonus),
            expression_bonus: Math.round(expression_bonus),
            speed_bonus: Math.round(speed_bonus),
            total_power: Math.round(total_power),
            height: parseFloat(height.toFixed(4)),
            reach: parseFloat(reach.toFixed(4)),
            shoulder: parseFloat(shoulder.toFixed(4)),
            expression: parseFloat(expression.toFixed(4)),
            pose: parseFloat(pose.toFixed(4)),
            // バトル用の細分化数値
            punch_power: Math.round(total_power * 0.3),
            kick_power: Math.round(total_power * 0.4),
            speed_power: Math.round(total_power * 0.3)
        };
        
    } catch (error) {
        console.error('MediaPipe数値計算エラー:', error);
        return generateRandomCombatStats();
    }
}

// 分散を計算するヘルパー関数
function calculateVariance(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
}

// ランダム数値生成（フォールバック用）
function generateRandomCombatStats() {
    const mockScore = Math.floor(Math.random() * 8000 + 2000);
    return {
        base_power: Math.round(mockScore * 0.7),
        pose_bonus: Math.round(mockScore * 0.15),
        expression_bonus: Math.round(mockScore * 0.1),
        speed_bonus: Math.round(mockScore * 0.05),
        total_power: mockScore,
        height: Math.random() * 0.3 + 0.4,
        reach: Math.random() * 0.8 + 0.6,
        shoulder: Math.random() * 0.3 + 0.2,
        expression: Math.random() * 0.1 + 0.05,
        pose: Math.random() * 0.4 + 0.3,
        punch_power: Math.round(mockScore * 0.3),
        kick_power: Math.round(mockScore * 0.4),
        speed_power: Math.round(mockScore * 0.3)
    };
}

// リアルタイム身体測定計算（MediaPipe使用時）
function calculateRealBodyStats() {
    if (!lastPoseResults || !lastPoseResults.poseLandmarks) {
        return null;
    }
    
    const landmarks = lastPoseResults.poseLandmarks;
    
    // 肩幅計算（左肩-右肩の距離）
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const shoulderWidth = Math.sqrt(
        Math.pow(leftShoulder.x - rightShoulder.x, 2) + 
        Math.pow(leftShoulder.y - rightShoulder.y, 2)
    ) * 100; // スケール調整
    
    // リーチ計算（両手の先端間距離）
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];
    const reachDistance = Math.sqrt(
        Math.pow(leftWrist.x - rightWrist.x, 2) + 
        Math.pow(leftWrist.y - rightWrist.y, 2)
    ) * 120; // スケール調整
    
    // 身長計算（頭頂-足首の距離）
    const nose = landmarks[0];
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];
    const avgAnkle = { 
        y: (leftAnkle.y + rightAnkle.y) / 2 
    };
    const height = Math.abs(nose.y - avgAnkle.y) * 180 + 150; // 基準身長調整
    
    // 姿勢スコア計算（肩と腰のアライメント）
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const shoulderCenter = { y: (leftShoulder.y + rightShoulder.y) / 2 };
    const hipCenter = { y: (leftHip.y + rightHip.y) / 2 };
    
    // MediaPipeランドマークから実際の戦闘力を計算
    const combatStats = calculateCombatPowerFromLandmarks(landmarks);
    
    return {
        height: combatStats.height * 180 + 150, // cm表示用に調整
        reach: combatStats.reach * 120,         // 表示用調整
        shoulder: combatStats.shoulder * 100,   // 表示用調整
        posture: 100 - combatStats.pose * 100, // 姿勢スコア
        // 追加の戦闘力データ
        combatPower: combatStats.total_power,
        basePower: combatStats.base_power,
        poseBonus: combatStats.pose_bonus,
        expressionBonus: combatStats.expression_bonus
    };
}

// オフライン/オンライン対応のデータ生成
function generateOfflineStats() {
    // MediaPipe実測値を優先
    const realStats = calculateRealBodyStats();
    
    let rawStats;
    
    if (realStats && realStats.combatPower) {
        // MediaPipeで計算された実際の戦闘力を使用
        console.log('MediaPipe実測データでオフライン統計生成:', realStats);
        rawStats = {
            total_power: realStats.combatPower,
            base_power: realStats.basePower,
            pose_bonus: realStats.poseBonus,
            expression_bonus: realStats.expressionBonus,
            speed_bonus: Math.floor(Math.random() * 400 + 50), // スピードのみランダム
            height: realStats.height / 180 - 150/180, // 正規化
            reach: realStats.reach / 120,
            shoulder: realStats.shoulder / 100,
            expression: Math.random() * 8 + 2,
            pose: realStats.posture / 100
        };
    } else {
        // フォールバック: MediaPipe使用不可時のランダム値
        console.log('MediaPipe使用不可、ランダム値でフォールバック');
        let height, reach, shoulder, poseScore;
        
        height = Math.random() * 25 + 160; // 160-185cm
        reach = Math.random() * 30 + 150;  // 150-180cm
        shoulder = Math.random() * 10 + 35; // 35-45cm
        poseScore = Math.random() * 8 + 2;  // 2-10点
        
        // 身体データに基づく戦闘力計算
        const basePower = Math.floor(height * 15 + reach * 8 + shoulder * 50);
        const poseBonus = Math.floor(poseScore * 200 + Math.random() * 500);
        const expressionBonus = Math.floor(Math.random() * 300 + 100);
        const speedBonus = Math.floor(Math.random() * 400 + 50);
        const totalPower = basePower + poseBonus + expressionBonus + speedBonus;
        
        rawStats = {
            total_power: totalPower,
            base_power: basePower,
            pose_bonus: poseBonus,
            expression_bonus: expressionBonus,
            speed_bonus: speedBonus,
            height: height / 180 - 150/180, // 正規化
            reach: reach / 120,
            shoulder: shoulder / 100,
            expression: Math.random() * 8 + 2,
            pose: poseScore / 100
        };
    }
    
    // 安定化システムを適用してからUIを更新
    updateStats(rawStats);
}

// ===== クリックバトル機能 =====
function setupClickBattle() {
    console.log('setupClickBattle開始');
    console.log('battleState.player1:', battleState.player1);
    console.log('battleState.player2:', battleState.player2);
    
    // プレイヤー情報を表示
    document.getElementById('p1-name').textContent = battleState.player1.name || 'PLAYER1';
    document.getElementById('p2-name').textContent = battleState.player2.name || 'PLAYER2';
    document.getElementById('p1-base-power').textContent = (battleState.player1.score || 0).toLocaleString();
    document.getElementById('p2-base-power').textContent = (battleState.player2.score || 0).toLocaleString();
    document.getElementById('p1-current-power').textContent = (battleState.player1.score || 0).toLocaleString();
    document.getElementById('p2-current-power').textContent = (battleState.player2.score || 0).toLocaleString();
    
    // 初期化
    battleState.player1.currentScore = battleState.player1.score;
    battleState.player2.currentScore = battleState.player2.score;
    
    // ボタンイベント設定
    const btnStart = document.getElementById('btn-start-click-battle');
    const btnNextTurn = document.getElementById('btn-next-click-turn');
    const btnShowResult = document.getElementById('btn-show-battle-result');
    const btnExit = document.getElementById('btn-exit-click-battle');
    
    if (btnStart) btnStart.onclick = () => startClickBattle();
    if (btnNextTurn) btnNextTurn.onclick = () => startPlayer2Turn();
    if (btnShowResult) btnShowResult.onclick = () => showClickBattleResult();
    if (btnExit) btnExit.onclick = () => showScreen('title');
    
    // クリックエリア設定
    const clickArea = document.getElementById('click-area');
    if (clickArea) {
        clickArea.onclick = () => handleClick();
    }
    
    // 初期表示設定
    document.getElementById('click-battle-info').textContent = 'バトル開始準備が完了しました！';
    document.getElementById('p1-clicks').textContent = '0 clicks';
    document.getElementById('p2-clicks').textContent = '0 clicks';
    
    console.log('setupClickBattle完了');
}

function startClickBattle() {
    battleState.clickBattle = {
        phase: 'p1_turn',
        p1Clicks: 0,
        p2Clicks: 0,
        timer: 10,
        timerInterval: null,
        isActive: true
    };
    
    document.getElementById('btn-start-click-battle').classList.add('hidden');
    document.getElementById('click-battle-info').textContent = 'PLAYER1のターン！クリックしてください！';
    
    startClickTimer();
}

function startClickTimer() {
    const clickArea = document.getElementById('click-area');
    const timer = document.getElementById('click-timer');
    const timerDisplay = document.getElementById('timer-display');
    
    // UI表示
    clickArea.classList.remove('hidden');
    timer.classList.remove('hidden');
    
    battleState.clickBattle.timer = 10;
    timerDisplay.textContent = battleState.clickBattle.timer;
    
    // タイマー開始
    battleState.clickBattle.timerInterval = setInterval(() => {
        battleState.clickBattle.timer--;
        timerDisplay.textContent = battleState.clickBattle.timer;
        
        if (battleState.clickBattle.timer <= 0) {
            endCurrentTurn();
        }
    }, 1000);
}

function handleClick() {
    if (!battleState.clickBattle.isActive) return;
    
    const currentPhase = battleState.clickBattle.phase;
    
    if (currentPhase === 'p1_turn') {
        battleState.clickBattle.p1Clicks++;
        document.getElementById('p1-clicks').textContent = `${battleState.clickBattle.p1Clicks} clicks`;
    } else if (currentPhase === 'p2_turn') {
        battleState.clickBattle.p2Clicks++;
        document.getElementById('p2-clicks').textContent = `${battleState.clickBattle.p2Clicks} clicks`;
    }
    
    // クリック時のビジュアルエフェクト
    const clickArea = document.getElementById('click-area');
    clickArea.style.transform = 'scale(0.95)';
    setTimeout(() => {
        clickArea.style.transform = 'scale(1)';
    }, 100);
}

function endCurrentTurn() {
    battleState.clickBattle.isActive = false;
    clearInterval(battleState.clickBattle.timerInterval);
    
    const clickArea = document.getElementById('click-area');
    const timer = document.getElementById('click-timer');
    
    clickArea.classList.add('hidden');
    timer.classList.add('hidden');
    
    if (battleState.clickBattle.phase === 'p1_turn') {
        // Player1のターン終了、Player2のターンへ
        battleState.clickBattle.phase = 'waiting_p2';
        document.getElementById('click-battle-info').textContent = `PLAYER1: ${battleState.clickBattle.p1Clicks}クリック完了！PLAYER2の番です。`;
        document.getElementById('btn-next-click-turn').classList.remove('hidden');
    } else if (battleState.clickBattle.phase === 'p2_turn') {
        // Player2のターン終了、勝敗判定へ
        battleState.clickBattle.phase = 'finished';
        document.getElementById('click-battle-info').textContent = `PLAYER2: ${battleState.clickBattle.p2Clicks}クリック完了！勝敗を判定します。`;
        
        // 勝敗判定とマイナス補正適用
        applyBattleResult();
        document.getElementById('btn-show-battle-result').classList.remove('hidden');
    }
}

function startPlayer2Turn() {
    document.getElementById('btn-next-click-turn').classList.add('hidden');
    
    battleState.clickBattle.phase = 'p2_turn';
    battleState.clickBattle.isActive = true;
    
    document.getElementById('click-battle-info').textContent = 'PLAYER2のターン！クリックしてください！';
    document.getElementById('p2-clicks').textContent = '0 clicks';
    
    startClickTimer();
}

function applyBattleResult() {
    const p1Clicks = battleState.clickBattle.p1Clicks;
    const p2Clicks = battleState.clickBattle.p2Clicks;
    
    // クリック数が少ない方にマイナス補正を適用
    if (p1Clicks < p2Clicks) {
        // Player1のクリック数が少ない場合、Player1にマイナス補正
        const penalty = (p2Clicks - p1Clicks) * 100; // 差分×100ポイント減少
        battleState.player1.currentScore = Math.max(0, battleState.player1.score - penalty);
        battleState.player2.currentScore = battleState.player2.score; // Player2は元の戦闘力
    } else if (p2Clicks < p1Clicks) {
        // Player2のクリック数が少ない場合、Player2にマイナス補正
        const penalty = (p1Clicks - p2Clicks) * 100; // 差分×100ポイント減少
        battleState.player2.currentScore = Math.max(0, battleState.player2.score - penalty);
        battleState.player1.currentScore = battleState.player1.score; // Player1は元の戦闘力
    } else {
        // 同じクリック数の場合、どちらにもペナルティなし
        battleState.player1.currentScore = battleState.player1.score;
        battleState.player2.currentScore = battleState.player2.score;
    }
    
    // UI更新
    document.getElementById('p1-current-power').textContent = battleState.player1.currentScore.toLocaleString();
    document.getElementById('p2-current-power').textContent = battleState.player2.currentScore.toLocaleString();
}

function showClickBattleResult() {
    const p1Final = battleState.player1.currentScore;
    const p2Final = battleState.player2.currentScore;
    const p1Name = battleState.player1.name || 'PLAYER1';
    const p2Name = battleState.player2.name || 'PLAYER2';
    
    let winner, winnerIcon;
    if (p1Final > p2Final) {
        winner = p1Name;
        winnerIcon = '🥇';
    } else if (p2Final > p1Final) {
        winner = p2Name;
        winnerIcon = '🥇';
    } else {
        winner = '引き分け';
        winnerIcon = '🤝';
    }
    
    const p1Clicks = battleState.clickBattle.p1Clicks;
    const p2Clicks = battleState.clickBattle.p2Clicks;
    
    // バトル結果をサーバーに保存
    saveBattleResult({
        player1_name: p1Name,
        player1_score: battleState.player1.score,
        player1_clicks: p1Clicks,
        player1_final_score: p1Final,
        player2_name: p2Name,
        player2_score: battleState.player2.score,
        player2_clicks: p2Clicks,
        player2_final_score: p2Final,
        winner: winner
    });
    
    // 視覚的な勝敗通知を表示
    showBattleResultNotification({
        winner: winner,
        winnerIcon: winnerIcon,
        p1Name: p1Name,
        p2Name: p2Name,
        p1Score: battleState.player1.score,
        p2Score: battleState.player2.score,
        p1Final: p1Final,
        p2Final: p2Final,
        p1Clicks: p1Clicks,
        p2Clicks: p2Clicks
    });
}

// 視覚的な勝敗通知表示
function showBattleResultNotification(resultData) {
    const modal = document.getElementById('battle-result-modal');
    
    // モーダル内容を設定
    document.getElementById('victory-icon').textContent = resultData.winnerIcon;
    document.getElementById('battle-winner-title').textContent = 
        resultData.winner === '引き分け' ? 'DRAW!' : 'VICTORY!';
    document.getElementById('battle-winner-name').textContent = resultData.winner;
    
    // プレイヤー1の結果
    document.getElementById('p1-result-name').textContent = resultData.p1Name;
    document.getElementById('p1-result-score').textContent = 
        `${resultData.p1Score.toLocaleString()} → ${resultData.p1Final.toLocaleString()}`;
    document.getElementById('p1-result-clicks').textContent = `${resultData.p1Clicks} クリック`;
    
    // プレイヤー2の結果
    document.getElementById('p2-result-name').textContent = resultData.p2Name;
    document.getElementById('p2-result-score').textContent = 
        `${resultData.p2Score.toLocaleString()} → ${resultData.p2Final.toLocaleString()}`;
    document.getElementById('p2-result-clicks').textContent = `${resultData.p2Clicks} クリック`;
    
    // ペナルティ情報
    let penaltyText = '';
    if (resultData.p1Clicks < resultData.p2Clicks) {
        penaltyText = `⚠️ ${resultData.p1Name}にペナルティ適用 (-${(resultData.p2Clicks - resultData.p1Clicks) * 100}点)`;
    } else if (resultData.p2Clicks < resultData.p1Clicks) {
        penaltyText = `⚠️ ${resultData.p2Name}にペナルティ適用 (-${(resultData.p1Clicks - resultData.p2Clicks) * 100}点)`;
    } else {
        penaltyText = '✅ 引き分けのためペナルティなし';
    }
    document.getElementById('battle-penalty-info').textContent = penaltyText;
    
    // モーダルを表示
    modal.classList.remove('hidden');
    
    // 勝利サウンド（可能であれば）
    playVictorySound();
    
    // 結果確認ボタンのイベントリスナー
    document.getElementById('btn-close-battle-result').onclick = () => {
        modal.classList.add('hidden');
        showScreen('title'); // タイトル画面に戻る
    };
}

// 勝利音を再生（可能であれば）
function playVictorySound() {
    try {
        // 勝利音の再生を試みる（ブラウザがサポートしている場合）
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(523, audioContext.currentTime); // C5
        oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.2); // E5
        oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.4); // G5
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.6);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.6);
    } catch (error) {
        console.log('勝利音再生をスキップ:', error);
    }
}

function saveBattleResult(battleData) {
    console.log('バトル結果を専用DBに保存:', battleData);
    
    // ローカルストレージにも保存（オフライン対応）
    try {
        if (typeof(Storage) !== "undefined" && window.localStorage) {
            const localBattles = JSON.parse(localStorage.getItem('battleResults') || '[]');
            localBattles.push({
                ...battleData,
                id: Date.now(),
                battle_date: new Date().toISOString()
            });
            localStorage.setItem('battleResults', JSON.stringify(localBattles));
            console.log('バトル結果をローカルストレージに保存');
        } else {
            console.warn('LocalStorageが使用できません。バトル結果はサーバーのみに保存されます。');
        }
    } catch (error) {
        console.error('ローカルストレージ保存エラー:', error.message);
    }

    // Node.js APIに送信
    fetch('http://localhost:3001/api/save_battle_result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(battleData)
    })
    .then(response => response.json())
    .then(data => {
        console.log('バトル結果Node.js API保存成功:', data);
    })
    .catch(error => {
        console.error('バトル結果Node.js API保存エラー:', error);
    });
}

function fetchAndShowBattleRanking() {
    console.log('バトルランキングを取得中...');
    
    fetch('http://localhost:3001/api/get_battle_ranking')
        .then(response => response.json())
        .then(data => {
            console.log('バトルランキング取得成功:', data);
            displayBattleRanking(data);
        })
        .catch(error => {
            console.error('バトルランキング取得エラー:', error);
            // ローカルデータから表示
            displayBattleRankingFromLocal();
        });
}

function displayBattleRanking(battleRankingData) {
    const container = document.getElementById('ranking-container');
    if (!container) return;
    
    container.innerHTML = '<h3 class="text-xl font-bold mb-4">🏆 バトル勝利ランキング</h3>';
    
    if (!battleRankingData || battleRankingData.length === 0) {
        container.innerHTML += '<p class="text-gray-400">バトル記録がありません</p>';
        return;
    }
    
    battleRankingData.forEach((battle, index) => {
        const rankDiv = document.createElement('div');
        rankDiv.className = 'ranking-item flex justify-between items-center py-2 px-4 border-b border-gray-600';
        rankDiv.innerHTML = `
            <div class="rank-info">
                <span class="rank text-cyan-400">#${index + 1}</span>
                <span class="name text-white ml-4">${battle.name}</span>
            </div>
            <div class="score-info">
                <span class="wins text-yellow-400">${battle.wins}勝</span>
                <span class="latest text-gray-400 ml-2 text-sm">${new Date(battle.latest_battle).toLocaleDateString()}</span>
            </div>
        `;
        container.appendChild(rankDiv);
    });
}

function displayBattleRankingFromLocal() {
    try {
        if (typeof(Storage) === "undefined" || !window.localStorage) {
            console.warn('LocalStorageが使用できません。サーバーデータのみ表示します。');
            return;
        }
        
        const localBattles = JSON.parse(localStorage.getItem('battleResults') || '[]');
        const winCounts = {};
        
        localBattles.forEach(battle => {
            if (battle.winner && battle.winner !== '引き分け') {
                winCounts[battle.winner] = (winCounts[battle.winner] || 0) + 1;
            }
        });
        
        const rankingData = Object.entries(winCounts)
            .map(([name, wins]) => ({ name, wins, latest_battle: new Date().toISOString() }))
            .sort((a, b) => b.wins - a.wins);
            
        displayBattleRanking(rankingData);
    } catch (e) {
        console.error('ローカルバトルランキング表示エラー:', e.message);
    }
}

// ===== ランキング削除機能 =====
function deleteSelectedRankingData() {
    const checkboxes = document.querySelectorAll('.ranking-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('削除するデータを選択してください。');
        return;
    }
    
    if (!confirm(`${checkboxes.length}件のデータを削除しますか？この操作は元に戻せません。`)) {
        return;
    }
    
    const idsToDelete = Array.from(checkboxes).map(cb => cb.dataset.id);
    
    // ローカルストレージから削除
    try {
        if (typeof(Storage) !== "undefined" && window.localStorage) {
            const localData = JSON.parse(localStorage.getItem('battleIndexRanking') || '[]');
            const filteredData = localData.filter(item => !idsToDelete.includes(String(item.id)));
            localStorage.setItem('battleIndexRanking', JSON.stringify(filteredData));
            console.log('ローカルデータ削除完了');
        }
    } catch (e) {
        console.error('ローカルデータ削除エラー:', e.message);
    }
    
    // Node.js APIからも削除を試行
    fetch('http://localhost:3001/api/delete_scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete })
    }).then(res => res.json()).then(result => {
        if (result.success) {
            console.log('Node.js APIデータ削除完了');
        }
    }).catch(e => {
        console.warn('Node.js APIデータ削除失敗:', e);
    });
    
    fetchAndShowRanking();
}

function clearAllRankingData() {
    if (!confirm('すべてのランキングデータを削除しますか？この操作は元に戻せません。')) {
        return;
    }
    
    // ローカルストレージクリア
    try {
        if (typeof(Storage) !== "undefined" && window.localStorage) {
            localStorage.removeItem('battleIndexRanking');
            console.log('ローカルストレージクリア完了');
        }
    } catch (e) {
        console.error('ローカルストレージクリアエラー:', e.message);
    }
    
    // Node.js APIでのクリアも試行
    fetch('http://localhost:3001/api/clear_all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }).catch(e => {
        console.warn('Node.js APIデータクリア失敗:', e);
    });
    
    alert('すべてのデータを削除しました。');
    fetchAndShowRanking();
}

function getVideoFrame() {
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = measurementElements.video.videoWidth;
    tmpCanvas.height = measurementElements.video.videoHeight;
    const ctx = tmpCanvas.getContext('2d');
    ctx.drawImage(measurementElements.video, 0, 0, tmpCanvas.width, tmpCanvas.height);
    return tmpCanvas.toDataURL('image/jpeg');
}

window.addEventListener('DOMContentLoaded', () => {
    showScreen('title');
});
