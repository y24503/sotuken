// バトル進行用の状態を管理するグローバルオブジェクト
let battleState = {
        mode: null, // 現在のモード (例: '2pmeasure' など)
        step: 0,    // 現在の進行ステップ（主に2P対戦用）
        player1: {}, // プレイヤー1のデータ（名前、スコア、画像パスなど）
        player2: {}  // プレイヤー2のデータ
    };
    
    // 画面切り替え（共通関数）
    // 指定されたscreenNameの画面（#screen-XXX）のみを表示し、他をすべて非表示にする
    function showScreen(screenName) {
        // すべての画面要素（.screen クラスを持つもの）を非表示にする
        document.querySelectorAll('.screen').forEach(sc => sc.classList.add('hidden'));
        // 対象の画面要素（idが 'screen-' + screenName のもの）を取得
        const el = document.getElementById('screen-' + screenName);
        // 対象が存在すれば、hiddenクラスを削除して表示する
        if (el) el.classList.remove('hidden');
    }
    
    // ランキング削除（インラインonclick対応）
    // ranking.js が提供すればそちらを優先。未提供時は簡易フォールバック（最小実装）
    // window.deleteRankingEntry がまだ定義されていない場合のみ、このフォールバック関数を定義する
    if (typeof window !== 'undefined' && typeof window.deleteRankingEntry !== 'function') {
        try {
            // グローバルスコープ（window）に関数を定義し、HTMLのonclickから呼び出せるようにする
            window.deleteRankingEntry = function(id) {
                // 削除確認のダイアログを表示
                if (!confirm('このデータ を けす？ なまえ と え が きえるよ。')) return;
                // サーバーのAPI（/api/delete_score）に削除リクエストを送信
                fetch('/api/delete_score', {
                    method: 'POST', // POSTメソッドを使用
                    headers: { 'Content-Type': 'application/json' }, // ヘッダーでJSON形式を指定
                    body: JSON.stringify({ id }) // 削除対象のIDをJSONにして送信
                })
                .then(() => {
                    // 削除成功後、ランキングを再描画する
                    // もし ranking.js が読み込まれていて fetchAndShowRanking 関数が存在すればそれを呼ぶ
                    if (typeof window.fetchAndShowRanking === 'function') {
                        window.fetchAndShowRanking();
                    } else {
                        // 存在しない場合は、ページ全体をリロードしてランキングを更新する（簡易的な方法）
                        location.reload();
                    }
                })
                .catch(() => alert('さくじょ えらー')); // エラーが発生したらアラートを表示
            };
        } catch(e){} // エラーが発生しても処理を続行
    }
    
    // 初期画面表示とボタンイベント再バインド
    // HTMLの読み込みが完了した（DOMが構築された）時点で実行される
    window.addEventListener('DOMContentLoaded', () => {
        // 最初にタイトル画面を表示する
        showScreen('title');
    
        // スタート画面（タイトル画面）の各ボタンにイベントを設定する
        // （onclickプロパティに直接関数を代入。古い手法だが確実性はある）
        const btnGotoInstructions = document.getElementById('btn-goto-instructions'); // 「あそびかた」ボタン
        if (btnGotoInstructions) {
            btnGotoInstructions.onclick = () => showScreen('instructions'); // クリックで説明画面へ
        }
        const btnGotoRanking = document.getElementById('btn-goto-ranking'); // 「ランキング」ボタン
        if (btnGotoRanking) {
            btnGotoRanking.onclick = () => showScreen('ranking'); // クリックでランキング画面へ
        }
        const btnGoto2P = document.getElementById('btn-goto-2pmeasure'); // 「2Pたいせん」ボタン
        if (btnGoto2P) {
            btnGoto2P.onclick = () => showScreen('2pmeasure'); // クリックで2P対戦準備画面へ
        }
        
        // BGM（背景音楽）の初期化処理を呼び出す
        setupBGM();
        // 効果音（SE）のフォールバック（代替処理）初期化を呼び出す
        initSfxFallback();
    
        // --- グローバルクリック委譲（他画面のボタン反応を保証） ---
        // ページ全体(document)でクリックイベントを監視する（イベントデリゲーション）
        // これにより、後から表示される画面のボタンにも対応できる
        document.addEventListener('click', (ev) => {
            // クリックされた要素（ev.target）から一番近いボタンかリンク(a)を探す
            const target = ev.target.closest('button, a');
            if (!target) return; // ボタンやリンク以外がクリックされた場合は何もしない
    
            // クリックされた要素のIDに応じて処理を分岐
            switch (target.id) {
                case 'btn-back-to-title-1': // instructions（説明） -> title（タイトル）
                case 'btn-back-to-title-3': // ranking（ランキング） -> title（タイトル）
                    showScreen('title'); // タイトル画面に戻る
                    break;
                case 'btn-goto-gender': // instructions（説明） -> gender（性別選択）
                    showScreen('gender'); // 性別選択画面へ
                    break;
                case 'btn-back-to-instructions': // gender（性別選択） -> instructions（説明）
                    showScreen('instructions'); // 説明画面に戻る
                    break;
                case 'btn-2pmeasure-start': // 2人測定開始ボタン
                    try { 
                        startMeasurementFlow(); // 2人測定フロー（measurement.htmlへの遷移）を開始
                    } catch (e) { 
                        // エラー時はとりあえず測定画面（index.html内の）を表示
                        showScreen('measurement'); 
                    }
                    break;
                case 'btn-2pmeasure-exit': // 2人測定やめるボタン
                    showScreen('title'); // タイトル画面に戻る
                    break;
            }
    
            // --- 性別選択ボタン（gender-btn）の処理 ---
            // IDではなくクラス名で判定（男性・女性ボタン両方に対応）
            if (target.classList && target.classList.contains('gender-btn')) {
                // 選択した性別（'male' または 'female'）をグローバル変数に記録
                try { window._selectedGender = target.dataset.gender || 'male'; } catch(e) {}
                // 測定画面（index.html内の）を表示
                showScreen('measurement');
                // 単独測定開始（1P）
                try { 
                    showMeasurementUI(1); // 測定（measurement.htmlへの遷移）を開始
                } catch(e) {}
            }
        });
    
        // --- 測定結果（2人）から戻ってきたときの復帰処理 ---
        // ページ読み込み時に sessionStorage を確認し、両者のデータが揃っていればバトル画面へ遷移して表示します。
        // (measurement.html で2人分の測定が完了すると、この index.html に戻ってくるため)
        try {
            // ブラウザの一時保存領域(sessionStorage)から 'battleState' を読み込む
            const raw = sessionStorage.getItem('battleState');
            if (raw) { // データが存在する場合
                const bs = JSON.parse(raw); // JSON文字列をオブジェクトに戻す
                // 2P測定モードで、ステップが204（P2測定完了）で、両プレイヤーのデータが揃っているか確認
                if (bs && bs.mode === '2pmeasure' && bs.step === 204 && bs.player1 && bs.player2) {
                    // データをローカル変数に格納
                    const p1 = bs.player1;
                    const p2 = bs.player2;
                    // バトル画面を表示
                    showScreen('battle');
                    // バトル実行関数にプレイヤーデータを渡して開始
                    showBattleScreen({
                        image: p1.image || 'img/player1.jpg', // 画像（なければデフォルト）
                        name: p1.name || 'PLAYER1', // 名前（なければデフォルト）
                        score: p1.score || 0, // スコア（なければ0）
                        maxScore: p1.score || 0 // 最大スコア（=初期スコア）
                    }, {
                        image: p2.image || 'img/player2.jpg',
                        name: p2.name || 'PLAYER2',
                        score: p2.score || 0,
                        maxScore: p2.score || 0
                    });
                    // バトルが開始したので、使い終わったsessionStorageのデータは削除する
                    sessionStorage.removeItem('battleState');
                }
            }
        } catch(e){} // エラーが発生しても処理を続行
    });
    
    // --- ここから測定関連の実装 ---
    // 注: 実際の測定ロジック（カメラ映像処理など）は measurement.js に分離されています。
    // ここにあるのは、measurement.html へ遷移させるための「振り分け」処理です。
    
    /**
     * 測定UIを表示（実際には measurement.html へ遷移）
     * @param {number} playerNum - プレイヤー番号 (1 または 2)
     */
    function showMeasurementUI(playerNum) {
        // 測定画面を同一ページで表示する代わりに measurement.html を開く
        try {
            // 現在の battleState（モードがnullか'2pmeasure'かなど）を sessionStorage に保存する
            // これにより、遷移先の measurement.html が現在の状態を引き継げる
            const bs = window.battleState || { mode: null, step: 0 };
            sessionStorage.setItem('battleState', JSON.stringify(bs));
            // ページを measurement.html に遷移させる (URLパラメータでプレイヤー番号を渡す)
            window.location.href = `measurement.html?player=${encodeURIComponent(playerNum || 1)}`;
        } catch (e) {
            // エラー時も同様に遷移を試みる
            window.location.href = `measurement.html?player=${encodeURIComponent(playerNum || 1)}`;
        }
    }
    
    /**
     * 測定開始（showMeasurementUI と同じ）
     */
    function startMeasurement(playerNum) {
        // 実質 showMeasurementUI と同じ
        showMeasurementUI(playerNum);
    }
    
    /**
     * 2人測定フローを開始する（「2Pたいせん」準備画面の「START」ボタンで呼ばれる）
     */
    async function startMeasurementFlow() {
        // 2人測定モードであることを明示
        battleState.mode = '2pmeasure';
        battleState.step = 202; // ステップを「P1計測中」に設定
        // 状態を sessionStorage に保存して...
        try {
            sessionStorage.setItem('battleState', JSON.stringify(battleState));
        } catch(e){}
        // P1（1人目）の測定のために measurement.html へ遷移
        window.location.href = 'measurement.html?player=1';
    }
    
    // (三種バトル用の関数は削除されています)
    
    // --- 測定画面（index.html 内の #screen-measurement）関連の変数 ---
    // ※注意: 以下の変数は、measurement.html への遷移により、実際には使われていない可能性が高いです
    let measureTimeout = null; // 測定タイマー（setTimeoutのID）
    let lastSnapshotDataUrl = null; // 最後に撮影した写真（Data URL形式）
    let lastCombatStats = null; // 最後の戦闘力データ
    
    // 2回目の DOMContentLoaded リスナー
    // (1回目と2回目に分かれているが、どちらも同じタイミングで実行される。通常は1つにまとめる)
    document.addEventListener('DOMContentLoaded', () => {
        // --- 測定画面（index.html内の）のボタン取得 ---
        // ※※※ 注意 ※※※
        // 1P/2P測定ともに measurement.html へ即時遷移するため、
        // 以下の #btn-start-measure や #btn-name-ok などの処理は
        // 実際には実行されない「古いコード」である可能性が非常に高いです。
        // 実際の測定・名前入力処理は measurement.html 側で行われているはずです。
        // ※※※※※※※※※※
    
        const btnStartMeasure = document.getElementById('btn-start-measure'); // 測定開始ボタン
        const nameModal = document.getElementById('name-modal'); // 名前入力モーダル
        const inputPlayerName = document.getElementById('input-player-name'); // 名前入力欄
        const btnNameOk = document.getElementById('btn-name-ok'); // 名前入力OKボタン
        const btnNameCancel = document.getElementById('btn-name-cancel'); // 名前入力キャンセルボタン
    
        // (古いコード) 測定開始ボタンの処理
        if (btnStartMeasure) {
            btnStartMeasure.addEventListener('click', async () => {
                btnStartMeasure.disabled = true; // ボタンを無効化
                btnStartMeasure.textContent = 'MEASURING...'; // テキスト変更
    
                // ルーレット効果音の再生
                const seRoulette = document.getElementById('se-roulette');
                const seRoulette2 = document.getElementById('se-roulette2');
                if (seRoulette && seRoulette2) {
                    // (roulette2を2回 → rouletteを1回 再生するロジック)
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
    
                // (古いコード) 10秒後に測定を完了し、名前入力モーダルを表示する
                measureTimeout = setTimeout(async () => {
                    // measurementElements.canvas は measurement.html 側にあるため、ここでは null のはず
                    const dataUrl = measurementElements.canvas.toDataURL('image/jpeg');
                    lastSnapshotDataUrl = dataUrl; // 写真を保存
                    lastCombatStats = window._latestCombatStats || {}; // 戦闘力データを保存
                    // 名前入力モーダル表示
                    inputPlayerName.value = '';
                    nameModal.classList.remove('hidden');
                    inputPlayerName.focus();
                }, 10000); // 10秒 (10000ミリ秒)
            });
        }
    
        // (古いコード) 名前入力OKボタンの処理
        if (btnNameOk) {
            btnNameOk.addEventListener('click', async () => {
                const name = inputPlayerName.value.trim() || 'PLAYER'; // 名前を取得（なければ 'PLAYER'）
                nameModal.classList.add('hidden'); // モーダルを閉じる
                // サーバーに結果を保存（この saveResultToDB 関数はファイル下部で定義）
                const saveJson = await saveResultToDB(lastCombatStats, lastSnapshotDataUrl, name);
                btnStartMeasure.disabled = false; // スタートボタンを再度有効化
                btnStartMeasure.textContent = 'START';
    
                // (古いコード) 2人測定モードの進行管理
                if (battleState.mode === '2pmeasure') {
                    // 保存した画像のパス（失敗したら撮影したDataURLのまま）
                    const savedImgPath = (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl;
                    
                    if (battleState.step === 202) { // P1終了時
                        // P1のデータを battleState に保存
                        battleState.player1 = {
                            name: name || 'PLAYER1',
                            score: (window._latestCombatStats && window._latestCombatStats.total_power) || 0,
                            image: savedImgPath
                        };
                        battleState.step = 203; // ステップを「P2計測中」に進める
                        // P2の測定を開始（0.4秒後）
                        setTimeout(() => { showScreen('measurement'); startMeasurement(2); }, 400);
                        return; // P2測定に移るので、ここで処理を抜ける
                    }
    
                    if (battleState.step === 203) { // P2終了時
                        // P2のデータを battleState に保存
                        battleState.player2 = {
                            name: name || 'PLAYER2',
                            score: (window._latestCombatStats && window._latestCombatStats.total_power) || 0,
                            image: savedImgPath
                        };
                        const p1 = battleState.player1.score || 0;
                        const p2 = battleState.player2.score || 0;
                        // バトル画面を表示
                        showScreen('battle');
                        // バトル実行関数にデータを渡して開始
                        showBattleScreen({
                            image: battleState.player1.image || 'img/player1.jpg',
                            name: battleState.player1.name || 'PLAYER1',
                            score: p1,
                            maxScore: p1
                        }, {
                            image: battleState.player2.image || 'img/player2.jpg',
                            name: battleState.player2.name || 'PLAYER2',
                            score: p2,
                            maxScore: p2
                        });
                        return; // バトルに移るので処理を抜ける
                    }
                } else {
                    // (古いコード) 単独測定（1P）時はランキングページへ遷移
                    try {
                        // 実際には measurement.html 側で遷移が行われるはず
                        window.location.href = 'ranking.html';
                    } catch (e) {
                        window.location.href = 'ranking.html';
                    }
                }
            });
        }
    
        // (古いコード) 名前入力キャンセルボタンの処理
        if (btnNameCancel) {
            btnNameCancel.addEventListener('click', () => {
                nameModal.classList.add('hidden'); // モーダルを閉じる
                btnStartMeasure.disabled = false; // スタートボタンを有効化
                btnStartMeasure.textContent = 'START';
            });
        }
    
        // (古いコード) 測定画面のEXIT（戻る）ボタンの処理
        // buttons.backToTitle2 はファイル下部で定義されている
        if (buttons.backToTitle2) {
            buttons.backToTitle2.addEventListener('click', () => {
                // stopMeasurement(); // stopMeasurement関数はこのファイルに存在しない (measurement.js側にあるはず)
                showScreen('title'); // タイトル画面に戻る
                if (measureTimeout) { clearTimeout(measureTimeout); measureTimeout = null; } // 測定タイマーをキャンセル
                if (btnStartMeasure) {
                    btnStartMeasure.disabled = false;
                    btnStartMeasure.textContent = 'START';
                }
            });
        }
    
        // --- ここから再度、実行される可能性のある処理 ---
    
        // ボタン効果音を全ボタンに付与
        document.querySelectorAll('button, .btn, .hud-button').forEach(btn => {
            // 既存のonclickイベント（タイトル画面のボタンなど）を消さないよう、addEventListener を使用
            btn.removeEventListener('click', playButtonSE); // 重複登録を防止
            btn.addEventListener('click', playButtonSE); // クリック時に効果音再生関数を紐付け
        });
    
        // ランキングボタン（タイトル画面）の処理
        // ※ DOMContentLoaded 1回目でも onclick で設定しているが、こちらで addEventListener で上書き（または重複設定）している
        const btnGotoRanking = document.getElementById('btn-goto-ranking');
        if (btnGotoRanking) {
            btnGotoRanking.addEventListener('click', async () => {
                showScreen('ranking'); // ランキング画面を表示
                // 外部ファイル（ranking.js）で定義されているランキング取得・表示関数を呼び出す
                if (typeof window !== 'undefined' && typeof window.fetchAndShowRanking === 'function') {
                    await window.fetchAndShowRanking();
                } else {
                    // もし ranking.js が読み込めていなければ、フォールバック関数を呼ぶ
                    await fetchAndShowRankingFallback();
                }
            });
        }
        // ランキング画面の戻るボタン（#btn-back-to-title-3）の処理
        // ※ グローバルクリック委譲（1回目のDOMContentLoaded内）でも処理されている
        const btnBackToTitle3 = document.getElementById('btn-back-to-title-3');
        if (btnBackToTitle3) {
            btnBackToTitle3.addEventListener('click', () => {
                showScreen('title');
            });
        }
    });
    
    // ---- BGM: music フォルダの mp3/ogg/wav を自動検出し、選択再生 ----
    function setupBGM() {
        // BGM操作用のUI要素を取得
        const select = document.getElementById('bgm-select'); // 曲選択ドロップダウン
        const btnPlay = document.getElementById('bgm-play'); // 再生ボタン
        const btnStop = document.getElementById('bgm-stop'); // 停止ボタン
        const player = document.getElementById('bgm-player'); // <audio> タグ本体
        if (!select || !btnPlay || !btnStop || !player) return; // 必要な要素が揃っていなければ何もしない
    
        // サーバーのAPI（/api/music-list）からBGMのファイルリストを取得
        fetch('/api/music-list')
            .then(r => r.json()) // レスポンスをJSONとして解析
            .then(json => {
                if (!json || !Array.isArray(json.files)) return; // データが不正なら終了
    
                // ファイル名（bgm1.mp3, bgm2.mp3 ...）を数値順にソートする処理
                const parsed = json.files.map((name) => {
                    const m = name.match(/^bgm(\d+)\./i); // "bgm" + "数字" + "." のパターンにマッチ
                    const order = m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY; // マッチしたら数値、しなければ無限大（一番後ろ）
                    return { name, order }; // ファイル名と順序のオブジェクト
                }).sort((a, b) => {
                    if (a.order !== b.order) return a.order - b.order; // 数値でソート
                    return a.name.localeCompare(b.name); // 数値が同じならファイル名でソート
                });
    
                // ソートしたリストを <select> タグの <option> として追加
                parsed.forEach(({ name, order }) => {
                    const opt = document.createElement('option');
                    opt.value = 'music/' + name; // valueは実際のファイルパス
                    opt.textContent = isFinite(order) ? `BGM ${order}` : name; // 表示名は "BGM 1" またはファイル名
                    select.appendChild(opt);
                });
    
                // 既定選択: "bgm1.*" があれば、それを最初に選択状態にする
                const preferred = parsed.find(p => isFinite(p.order) && p.order === 1);
                if (preferred) {
                    select.value = 'music/' + preferred.name;
                }
            })
            .catch(() => {}); // リスト取得失敗時は何もしない
    
        // 再生ボタンのクリックイベント
        btnPlay.addEventListener('click', async () => {
            const url = select.value; // 選択中の曲のパスを取得
            if (!url) return;
            try {
                player.src = url; // <audio> タグの再生ソースを設定
                await player.play(); // 再生（非同期）
            } catch (e) {
                console.warn('BGM play error', e); // 再生エラーはコンソールに出力
            }
        });
    
        // 停止ボタンのクリックイベント
        btnStop.addEventListener('click', () => {
            try { 
                player.pause(); // 一時停止
                player.currentTime = 0; // 再生位置を最初に戻す
            } catch(e) {}
        });
    }
    
    // ===== バトル結果表示 =====
    // (この関数は showBattleScreen の最後で呼ばれるのではなく、
    //  showBattleScreen とは別の画面 #screen-battle-result を表示するためのものです)
    function showBattleResult({ p1, p2 }) {
        // 結果表示用のHTML要素を取得
        const p1NameEl = document.getElementById('battle-p1-name');
        const p2NameEl = document.getElementById('battle-p2-name');
        const p1ScoreEl = document.getElementById('battle-p1-score');
        const p2ScoreEl = document.getElementById('battle-p2-score');
        const winnerEl = document.getElementById('battle-winner-text');
        const btnRematch = document.getElementById('btn-battle-rematch'); // 再戦ボタン
        const btnBack = document.getElementById('btn-battle-back'); // タイトルへ戻るボタン
    
        // データをHTMLに反映
        if (p1NameEl) p1NameEl.textContent = p1.name;
        if (p2NameEl) p2NameEl.textContent = p2.name;
        if (p1ScoreEl) p1ScoreEl.textContent = (p1.score || 0).toLocaleString(); // 3桁区切り
        if (p2ScoreEl) p2ScoreEl.textContent = (p2.score || 0).toLocaleString();
    
        // 勝敗メッセージを決定
        let msg = '';
        if ((p1.score || 0) > (p2.score || 0)) msg = `Winner: ${p1.name}`;
        else if ((p1.score || 0) < (p2.score || 0)) msg = `Winner ${p2.name}`;
        else msg = 'Drrow！'; // 引き分け
        if (winnerEl) winnerEl.textContent = msg;
    
        // バトル結果画面（#screen-battle-result）を表示
        showScreen('battle-result');
    
        // 再戦ボタンの処理
        if (btnRematch) btnRematch.onclick = () => {
            // 状態をリセットして2人測定の準備画面（#screen-2pmeasure）に戻る
            battleState.mode = '2pmeasure';
            battleState.step = 201; // ステップを初期化
            battleState.player1 = { name: 'PLAYER1', score: 0 };
            battleState.player2 = { name: 'PLAYER2', score: 0 };
            showScreen('2pmeasure');
        };
        // 戻るボタンの処理
        if (btnBack) btnBack.onclick = () => showScreen('title');
    }
    
    // ===== バトル画面ロジック（スタートボタン→連打開始） =====
    /**
     * 2P対戦（連打バトル）の画面を表示・実行する
     * @param {object} player1 - P1のデータ { image, name, score, maxScore }
     * @param {object} player2 - P2のデータ { image, name, score, maxScore }
     */
    function showBattleScreen(player1, player2) {
        // --- バトル用のローカル変数初期化 ---
        let timeLimit = 10; // 制限時間（秒）
        let timer = timeLimit; // 残り時間タイマー
        let phase = 1; // 1: 1P連打中, 2: 2P連打中, 3: 結果
        let clickCount1 = 0; // P1のクリック回数
        let clickCount2 = 0; // P2のクリック回数
        let intervalId = null; // タイマー（setInterval）のID
        let isBattleActive = false; // 連打受付中フラグ
    
        // --- UI初期化 ---
        // プレイヤーの測定結果を画面に反映
        document.getElementById('battle-img1').src = player1.image;
        document.getElementById('battle-img2').src = player2.image;
        document.getElementById('battle-name1').textContent = player1.name;
        document.getElementById('battle-name2').textContent = player2.name;
        document.getElementById('battle-score1').textContent = `${player1.score}/${player1.maxScore}`;
        document.getElementById('battle-score2').textContent = `${player2.score}/${player2.maxScore}`;
        document.getElementById('battle-gauge1').style.width = '100%'; // ゲージを100%に
        document.getElementById('battle-gauge2').style.width = '100%';
        document.getElementById('battle-timer').textContent = `00:${String(timeLimit).padStart(2,'0')}`;
      document.getElementById('battle-instruct').textContent = 'バトル開始ボタンを押してください';
        document.getElementById('battle-mouse').classList.add('hidden'); // 連打エリアは隠す
        document.getElementById('battle-start-btn').classList.remove('hidden'); // １Pスタートボタンを表示
        document.getElementById('battle-start-btn-2p').classList.add('hidden'); // ２Pスタートボタンを隠す
        document.getElementById('click-counter').textContent = 'クリック数: 0'; // クリック数をリセット        // --- 1P用スタートボタンのクリックイベント ---
        document.getElementById('battle-start-btn').onclick = () => {
            document.getElementById('battle-start-btn').classList.add('hidden'); // スタートボタンを隠す
            document.getElementById('battle-mouse').classList.remove('hidden'); // 連打エリアを表示
            document.getElementById('battle-instruct').textContent = '1Pは連打！';
            isBattleActive = true; // 連打受付開始
            phase = 1; // 1Pのターン
            timer = timeLimit; // タイマーリセット
            clickCount1 = 0; // 1Pクリック数リセット
            document.getElementById('click-counter').textContent = 'クリック数: 0';
            document.getElementById('battle-timer').textContent = `00:${String(timer).padStart(2,'0')}`;

            // 1秒ごとにタイマーを減らす
            intervalId = setInterval(() => {
                timer--; // 1秒減らす
                document.getElementById('battle-timer').textContent = `00:${String(timer).padStart(2,'0')}`;

                // --- 1Pのターン終了 ---
                if (timer <= 0) {
                    clearInterval(intervalId); // 1Pのタイマー停止
                    isBattleActive = false; // 連打受付停止
                    document.getElementById('battle-mouse').classList.add('hidden'); // 連打エリアを隠す

                    if (phase === 1) { // 1Pのターンだった場合
                        // --- 2P連打へ移行準備 ---
                        phase = 2; // 2Pのターン
                        timer = timeLimit; // タイマーリセット
                        document.getElementById('battle-timer').textContent = `00:${String(timer).padStart(2,'0')}`;
                        document.getElementById('battle-instruct').textContent = '２Pのターンです。STARTボタンを押してください！';
                        document.getElementById('battle-start-btn-2p').classList.remove('hidden'); // ２Pスタートボタン表示
                    }
                }
            }, 1000); // 1秒ごと
        };

        // --- 2P用スタートボタンのクリックイベント ---
        document.getElementById('battle-start-btn-2p').onclick = () => {
            document.getElementById('battle-start-btn-2p').classList.add('hidden'); // ２Pスタートボタンを隠す
            document.getElementById('battle-mouse').classList.remove('hidden'); // 連打エリアを表示
            document.getElementById('battle-instruct').textContent = '2Pは連打！';
            isBattleActive = true; // 連打受付再開
            clickCount2 = 0; // 2Pクリック数リセット
            document.getElementById('click-counter').textContent = 'クリック数: 0';

            // 2Pのタイマー開始
            intervalId = setInterval(() => {
                timer--;
                document.getElementById('battle-timer').textContent = `00:${String(timer).padStart(2,'0')}`;

                // --- 2Pのターン終了（バトル終了） ---
                if (timer <= 0) {
                    clearInterval(intervalId); // 2Pタイマー停止
                    isBattleActive = false; // 連打受付終了
                    document.getElementById('battle-mouse').classList.add('hidden'); // 連打エリアを隠す

                    // --- 勝敗判定 ---
                    // P1へのダメージ = P2のクリック数 * 1000
                    let damage1 = clickCount2 * 1000;
                    // P2へのダメージ = P1のクリック数 * 1000
                    let damage2 = clickCount1 * 1000;
                    // 最終スコア（HP）を計算（0未満にならないように Math.max を使用）
                    let final1 = Math.max(0, player1.score - damage1);
                    let final2 = Math.max(0, player2.score - damage2);

                    // 最終スコアとゲージを更新
                    document.getElementById('battle-score1').textContent = `${final1}/${player1.maxScore}`;
                    document.getElementById('battle-score2').textContent = `${final2}/${player2.maxScore}`;
                    document.getElementById('battle-gauge1').style.width = `${(final1 / player1.maxScore) * 100}%`;
                    document.getElementById('battle-gauge2').style.width = `${(final2 / player2.maxScore) * 100}%`;

                    // 勝敗メッセージを表示
                    if (final1 > final2) {
                        document.getElementById('battle-instruct').textContent = '1Pの勝ち！';
                    } else if (final2 > final1) {
                        document.getElementById('battle-instruct').textContent = '2Pの勝ち！';
                    } else {
                        document.getElementById('battle-instruct').textContent = '引き分け！';
                    }
                    // (注: この後、結果画面 #screen-battle-result へ自動遷移するロジックはここにはない)
                    // (showBattleResult 関数は別途呼び出す必要がある)
                }
            }, 1000); // 1秒ごと
        };        // --- 連打エリアのクリックイベント ---
        document.getElementById('battle-mouse').onclick = function(event) {
            if (!isBattleActive) return; // 連打受付中じゃなければ何もしない

            // 波紋エフェクトを作成
            createRippleEffect(event, this);

            if (phase === 1) {
                clickCount1++; // 1Pのターンなら P1のカウントを増やす
                document.getElementById('click-counter').textContent = `クリック数: ${clickCount1}`;
            } else if (phase === 2) {
                clickCount2++; // 2Pのターンなら P2のカウントを増やす
                document.getElementById('click-counter').textContent = `クリック数: ${clickCount2}`;
            }
        };

        // 波紋エフェクトを作成する関数
        function createRippleEffect(event, element) {
            const rect = element.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const ripple = document.createElement('div');
            ripple.className = 'ripple';
            ripple.style.left = (x - 25) + 'px';
            ripple.style.top = (y - 25) + 'px';
            ripple.style.width = '50px';
            ripple.style.height = '50px';

            element.appendChild(ripple);

            // アニメーション終了後に要素を削除
            setTimeout(() => {
                if (ripple.parentNode) {
                    ripple.parentNode.removeChild(ripple);
                }
            }, 600);
        }        // --- バトル画面のEXIT（戻る）ボタン ---
        document.getElementById('battle-exit').onclick = () => {
            clearInterval(intervalId); // バトルタイマーを強制停止
            showScreen('title'); // タイトル画面に戻る
        };
    }
    
    // ---- 効果音フォールバック: sfx/ が無い環境でも動くようにパスを補正 ----
    function initSfxFallback() {
        const testUrl = 'sfx/button.mp3'; // テスト用のファイルパス
        // HEADメソッドでファイルの存在確認だけを行う（ファイル本体はダウンロードしない）
        fetch(testUrl, { method: 'HEAD' }).then(res => {
            if (res.ok) return; // ファイルが存在すれば（sfx/ が使える）何もしない (Aプラン)
            
            // --- sfx/ が不在の場合 (Bプラン：フォールバック) ---
            // 既存レイアウト（ルート直下、sfx/ がない）のパスに差し替える
            const map = [
                { id: 'se-button', file: 'button.mp3' }, // #se-button の src を 'button.mp3' に変更
                { id: 'se-roulette', file: 'roulette.mp3' },
                { id: 'se-roulette2', file: 'roulette2.mp3' },
            ];
            map.forEach(({ id, file }) => {
                const el = document.getElementById(id); // <audio> タグを取得
                if (el) el.src = file; // src属性をフォールバックパスに書き換え
            });
        }).catch(() => {
            // ネットワークエラー時やfetch自体に失敗した場合は何もしない
            // （既定のsfx/パスで動作を試みる）
        });
    }
    
    // ---- ランキング機能は外部ファイル (js/ranking.js) に委譲します ----
    // ここでは外部の fetchAndShowRanking を呼ぶフォールバックだけを用意。
    async function fetchAndShowRankingFallback() {
        // ranking.js が読み込まれていれば、そちらの関数を呼び出す
        if (typeof window !== 'undefined' && typeof window.fetchAndShowRanking === 'function') {
            return window.fetchAndShowRanking();
        }
        // ranking.js がない場合は、ランキング領域にエラーメッセージを表示
        const rankingList = document.getElementById('ranking-list');
        if (rankingList) rankingList.innerHTML = '<div class="text-center text-gray-400">ランキング機能は利用できません</div>';
    }
    
    // ---- measurement.js の実装を優先して呼ぶラッパー（包む）関数に置換 ----
    /**
     * 測定結果をDBに保存する（フォールバック付き）
     * @param {object} combatStats - 戦闘力データ
     * @param {string} imageDataUrl - 撮影した画像のData URL
     * @param {string} name - プレイヤー名
     */
    async function saveResultToDB(combatStats, imageDataUrl, name = 'PLAYER') {
        // Aプラン: measurement.js が提供する saveResultToDB 関数が存在し、
        // かつ、それがこの関数自身でない（無限ループ防止）場合
        if (typeof window !== 'undefined' && typeof window.saveResultToDB === 'function' && window.saveResultToDB !== saveResultToDB) {
            try { 
                // measurement.js 側の実装を呼び出す
                return await window.saveResultToDB(combatStats, imageDataUrl, name); 
            } catch(e) { 
                // Aプランが失敗したら、Bプラン（フォールバック）へ進む
            }
        }
    
        // Bプラン（フォールバック）: このファイル内の古いPOST実装を実行
        // (measurement.js が読み込めていない場合や、古いコード（btnNameOk）から呼ばれた場合)
        try {
            const res = await fetch('/api/save_score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    score: combatStats && combatStats.total_power ? combatStats.total_power : 0,
                    image: imageDataUrl
                })
            });
            const json = await res.json();
            // 保存成功時、プレビュー画像を表示（古いコード用）
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
    
    // --- 効果音再生 ---
    const seButton = document.getElementById('se-button'); // ボタン用 <audio> タグ
    function playButtonSE() {
        if (seButton) {
            seButton.currentTime = 0; // 再生位置を最初に戻す（連打できるように）
            seButton.play(); // 再生
        }
    }
    
    // --- DOM取得 ---
    // 主要なHTML要素をあらかじめ取得し、オブジェクトにまとめておく
    
    // 各画面のラッパー要素
    const screens = {
        title: document.getElementById('screen-title'),
        instructions: document.getElementById('screen-instructions'),
        gender: document.getElementById('screen-gender'),
        measurement: document.getElementById('screen-measurement'),
        ranking: document.getElementById('screen-ranking'),
        // 追加: バトル画面 & 結果画面を取得しておく（index.html に統合したため必要）
        battle: document.getElementById('screen-battle'),
        battleResult: document.getElementById('screen-battle-result')
    };
    
    // 主要なボタン要素（主に古いコードや、addEventListener で設定し直す前のもの）
    const buttons = {
        genderBtns: document.querySelectorAll('.gender-btn'),
        backToTitle2: document.getElementById('btn-back-to-title-2'), // 測定画面 -> タイトル
        gotoInstructions: document.getElementById('btn-goto-instructions'), // タイトル -> 説明
        gotoGender: document.getElementById('btn-goto-gender'), // 説明 -> 性別選択
        backToTitle1: document.getElementById('btn-back-to-title-1'), // 説明 -> タイトル
        backToInstructions: document.getElementById('btn-back-to-instructions') // 性別選択 -> 説明
    };
    
    // 測定画面（index.html内の、古いコードが参照する）のUI要素
    // ※ 実際には measurement.html 側で使われる要素群
    const measurementElements = {
        video: document.getElementById('input-video'), // カメラ映像
        canvas: document.getElementById('output-canvas'), // 描画キャンバス
        socketStatus: document.getElementById('socket-status'), // サーバー接続状態
        totalPower: document.getElementById('total-power'), // 総合戦闘力
        basePower: document.getElementById('base-power'), // 基礎戦闘力
        poseBonus: document.getElementById('pose-bonus'), // ポーズボーナス
        expressionBonus: document.getElementById('expression-bonus'), // 表情ボーナス
        speedBonus: document.getElementById('speed-bonus'), // 速度ボーナス
        statHeight: document.getElementById('stat-height'), // 身長
        statReach: document.getElementById('stat-reach'), // リーチ
        statShoulder: document.getElementById('stat-shoulder'), // 肩幅
        statExpression: document.getElementById('stat-expression'), // 表情
        statPose: document.getElementById('stat-pose') // ポーズ
    };