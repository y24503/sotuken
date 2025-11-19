// Enhanced Node.js server with Express API and WebSocket
// Replaces PHP and Python functionality

const { WebSocketServer } = require('ws');
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const PORT = 8765;
const HTTP_PORT = 3001;

// データファイルのパス
const DATA_DIR = path.join(__dirname, 'data');
const RANKING_FILE = path.join(DATA_DIR, 'ranking.json');
const BATTLE_FILE = path.join(DATA_DIR, 'battle_results.json');
const IMAGES_DIR = path.join(__dirname, '..', 'src');

// データディレクトリと画像ディレクトリを作成
async function ensureDirectories() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(IMAGES_DIR, { recursive: true });
  } catch (error) {
    // ディレクトリが既に存在する場合は無視
  }
}

// JSONファイルからデータを読み取り
async function readJsonData(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// JSONファイルにデータを書き込み
async function writeJsonData(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`データ書き込みエラー (${filePath}):`, error);
    return false;
  }
}

// Base64画像をファイルに保存
async function saveBase64Image(base64Data, name) {
  if (!base64Data || !base64Data.startsWith('data:')) {
    return null;
  }

  try {
    // Base64データの解析
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;

    const [, , base64] = matches;
    const buffer = Buffer.from(base64, 'base64');

    // ファイル名の生成
    const sanitizedName = name.replace(/[^A-Za-z0-9_\-]/g, '_');
    const timestamp = Date.now();
    const fileName = `${sanitizedName}_${timestamp}.png`;
    const filePath = path.join(IMAGES_DIR, fileName);

    await fs.writeFile(filePath, buffer);
    console.log(`画像保存成功: ${fileName}`);
    return fileName;
  } catch (error) {
    console.error('画像保存エラー:', error);
    return null;
  }
}

// MediaPipe互換の戦闘力計算
function calculateCombatPower(landmarks) {
  if (!landmarks || landmarks.length < 33) {
    // ランドマークがない場合はランダム値
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
      pose: Math.random() * 0.4 + 0.3
    };
  }

  try {
    // MediaPipeランドマークから実際の値を計算
    const height = Math.abs(landmarks[0].y - (landmarks[29].y + landmarks[30].y) / 2);
    const reach = Math.sqrt(
      Math.pow(landmarks[15].x - landmarks[16].x, 2) + 
      Math.pow(landmarks[15].y - landmarks[16].y, 2)
    );
    const shoulder = Math.sqrt(
      Math.pow(landmarks[11].x - landmarks[12].x, 2) + 
      Math.pow(landmarks[11].y - landmarks[12].y, 2)
    );
    const spine_center_x = (landmarks[23].x + landmarks[24].x) / 2;
    const spine_center_y = (landmarks[23].y + landmarks[24].y) / 2;
    const pose = Math.sqrt(
      Math.pow(landmarks[0].x - spine_center_x, 2) + 
      Math.pow(landmarks[0].y - spine_center_y, 2)
    );

    // 表情の計算（顔のランドマーク0-4の分散）
    const face_points = [landmarks[0], landmarks[1], landmarks[2], landmarks[3], landmarks[4]];
    const face_x_coords = face_points.map(p => p.x);
    const face_y_coords = face_points.map(p => p.y);
    const face_mean_x = face_x_coords.reduce((sum, x) => sum + x, 0) / face_x_coords.length;
    const face_mean_y = face_y_coords.reduce((sum, y) => sum + y, 0) / face_y_coords.length;
    const face_variance_x = face_x_coords.reduce((sum, x) => sum + Math.pow(x - face_mean_x, 2), 0) / face_x_coords.length;
    const face_variance_y = face_y_coords.reduce((sum, y) => sum + Math.pow(y - face_mean_y, 2), 0) / face_y_coords.length;
    const expression = Math.sqrt(face_variance_x + face_variance_y);

    // 戦闘力計算（server.pyと同じ係数）
    const height_score = height * 100000;
    const reach_score = reach * 150000;
    const shoulder_score = shoulder * 80000;
    const pose_bonus = pose * 50000;
    const expression_bonus = expression * 30000;
    const speed_bonus = 0; // WebSocketからの情報に基づいて後で追加可能

    const base_power = height_score + reach_score + shoulder_score;
    const total_power = base_power + pose_bonus + expression_bonus + speed_bonus;

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
      pose: parseFloat(pose.toFixed(4))
    };
  } catch (error) {
    console.error('戦闘力計算エラー:', error);
    // エラー時はランダム値を返す
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
      pose: Math.random() * 0.4 + 0.3
    };
  }
}

// WebSocketレスポンス生成
function makeWebSocketResponse(imageDataUrl, landmarks = null) {
  const combat_stats = calculateCombatPower(landmarks);
  
  return JSON.stringify({
    image: (typeof imageDataUrl === 'string' ? imageDataUrl.trim() : ''),
    combat_stats: combat_stats
  });
}

// Express.js セットアップ
function setupExpressServer() {
  const app = express();
  
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  
  // 静的ファイル提供（画像用）
  app.use('/src', express.static(IMAGES_DIR));
  
  // ランキング取得
  app.get('/api/get_ranking', async (req, res) => {
    try {
      const data = await readJsonData(RANKING_FILE);
      const sortedData = data.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 20);
      res.json(sortedData);
    } catch (error) {
      res.status(500).json({ error: 'ランキング取得に失敗しました' });
    }
  });
  
  // スコア保存
  app.post('/api/save_score', async (req, res) => {
    try {
      const { name, score, image, stats } = req.body;
      
      if (!name || score === undefined) {
        return res.status(400).json({ success: false, message: '名前またはスコアがありません' });
      }
      
      // 画像保存
      let savedImageName = null;
      if (image) {
        savedImageName = await saveBase64Image(image, name);
      }
      
      // ランキングデータ読み取り
      const rankingData = await readJsonData(RANKING_FILE);
      
      // 新しいエントリを追加
      const newEntry = {
        id: Date.now(),
        name: name,
        score: parseInt(score),
        image: savedImageName,
        stats: stats,
        created_at: new Date().toISOString()
      };
      
      rankingData.push(newEntry);
      
      // データ保存
      const saved = await writeJsonData(RANKING_FILE, rankingData);
      
      if (saved) {
        res.json({ 
          success: true, 
          message: 'スコアを保存しました！',
          image: savedImageName 
        });
      } else {
        res.status(500).json({ success: false, message: 'スコアの保存に失敗しました' });
      }
    } catch (error) {
      console.error('スコア保存エラー:', error);
      res.status(500).json({ success: false, message: 'サーバーエラー' });
    }
  });
  
  // 選択されたスコア削除
  app.post('/api/delete_scores', async (req, res) => {
    try {
      const { ids } = req.body;
      
      if (!ids || !Array.isArray(ids)) {
        return res.status(400).json({ success: false, message: '削除対象のIDがありません' });
      }
      
      const rankingData = await readJsonData(RANKING_FILE);
      const filteredData = rankingData.filter(item => !ids.includes(String(item.id)));
      
      const saved = await writeJsonData(RANKING_FILE, filteredData);
      
      if (saved) {
        res.json({ success: true, message: '選択されたデータを削除しました' });
      } else {
        res.status(500).json({ success: false, message: '削除に失敗しました' });
      }
    } catch (error) {
      res.status(500).json({ success: false, message: 'サーバーエラー' });
    }
  });
  
  // 全スコア削除
  app.post('/api/clear_all', async (req, res) => {
    try {
      const saved = await writeJsonData(RANKING_FILE, []);
      
      if (saved) {
        res.json({ success: true, message: 'すべてのデータを削除しました' });
      } else {
        res.status(500).json({ success: false, message: '削除に失敗しました' });
      }
    } catch (error) {
      res.status(500).json({ success: false, message: 'サーバーエラー' });
    }
  });
  
  // バトル結果保存
  app.post('/api/save_battle_result', async (req, res) => {
    try {
      const battleData = req.body;
      
      // 必要なフィールドの検証
      const requiredFields = [
        'player1_name', 'player2_name', 'player1_score', 'player2_score',
        'player1_clicks', 'player2_clicks', 'player1_final_score', 'player2_final_score', 'winner'
      ];
      
      for (const field of requiredFields) {
        if (battleData[field] === undefined) {
          return res.status(400).json({ success: false, message: `フィールド ${field} が不足しています` });
        }
      }
      
      const battleResults = await readJsonData(BATTLE_FILE);
      
      const newBattleResult = {
        id: Date.now(),
        ...battleData,
        battle_date: new Date().toISOString()
      };
      
      battleResults.push(newBattleResult);
      
      const saved = await writeJsonData(BATTLE_FILE, battleResults);
      
      if (saved) {
        res.json({ success: true, message: 'バトル結果を保存しました' });
      } else {
        res.status(500).json({ success: false, message: 'バトル結果の保存に失敗しました' });
      }
    } catch (error) {
      console.error('バトル結果保存エラー:', error);
      res.status(500).json({ success: false, message: 'サーバーエラー' });
    }
  });
  
  // バトルランキング取得
  app.get('/api/get_battle_ranking', async (req, res) => {
    try {
      const battleData = await readJsonData(BATTLE_FILE);
      
      // 勝利数を集計
      const winCounts = {};
      battleData.forEach(battle => {
        if (battle.winner && battle.winner !== '引き分け') {
          winCounts[battle.winner] = (winCounts[battle.winner] || 0) + 1;
        }
      });
      
      // ランキング形式に変換
      const ranking = Object.entries(winCounts)
        .map(([name, wins]) => ({
          name,
          wins,
          latest_battle: new Date().toISOString()
        }))
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 50);
      
      res.json(ranking);
    } catch (error) {
      res.status(500).json({ error: 'バトルランキングの取得に失敗しました' });
    }
  });
  
  app.listen(HTTP_PORT, () => {
    console.log(`Express HTTP API server started on http://localhost:${HTTP_PORT}`);
  });
}

// WebSocketサーバーセットアップ
function setupWebSocketServer() {
  const wss = new WebSocketServer({ port: PORT, host: 'localhost' });
  console.log(`WebSocket server started on ws://localhost:${PORT}`);

  wss.on('connection', (ws) => {
    console.log('WebSocketクライアント接続');

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      
      try {
        const message = data.toString('utf8');
        
        // クライアントからのデータが画像の場合
        if (message.startsWith('data:image')) {
          ws.send(makeWebSocketResponse(message));
        } else {
          // JSON形式のランドマークデータの場合
          try {
            const parsedData = JSON.parse(message);
            if (parsedData.landmarks && parsedData.image) {
              ws.send(makeWebSocketResponse(parsedData.image, parsedData.landmarks));
            } else {
              ws.send(makeWebSocketResponse(message));
            }
          } catch {
            ws.send(makeWebSocketResponse(message));
          }
        }
      } catch (e) {
        console.error('WebSocketメッセージ処理エラー:', e);
        ws.send(makeWebSocketResponse(''));
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocketエラー:', err.message);
    });

    ws.on('close', () => {
      console.log('WebSocketクライアント切断');
    });
  });
}

// メイン処理
async function startServer() {
  await ensureDirectories();
  setupExpressServer();
  setupWebSocketServer();
  console.log('全てのサーバーが正常に起動しました');
}

// サーバー起動
startServer().catch(console.error);

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\nサーバーを停止しています...');
  process.exit(0);
});
