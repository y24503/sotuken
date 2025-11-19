<?php
// --- レスポンスをJSON形式に設定 ---
header('Content-Type: application/json');
// --- データベースファイル名 ---
$db_file = 'database.sqlite';
$battle_db_file = 'battle_database.sqlite';
$is_new_db = !file_exists($db_file);
$is_new_battle_db = !file_exists($battle_db_file);

try {
    // --- SQLiteデータベースに接続 ---
    // PDO (PHP Data Objects) を使うことで、安全にデータベースを操作できます。
    $pdo = new PDO('sqlite:' . $db_file);
    // エラー発生時に例外をスローするように設定
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // バトル用データベース接続
    $battle_pdo = new PDO('sqlite:' . $battle_db_file);
    $battle_pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // --- もしデータベースが新規作成された場合、テーブルを作成する ---
    if ($is_new_db) {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS ranking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                score INTEGER NOT NULL,
                image TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ");
    }

    // バトル用テーブル作成
    if ($is_new_battle_db) {
        $battle_pdo->exec("
            CREATE TABLE IF NOT EXISTS battle_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player1_name TEXT NOT NULL,
                player1_score INTEGER NOT NULL,
                player1_clicks INTEGER NOT NULL,
                player1_final_score INTEGER NOT NULL,
                player2_name TEXT NOT NULL,
                player2_score INTEGER NOT NULL,
                player2_clicks INTEGER NOT NULL,
                player2_final_score INTEGER NOT NULL,
                winner TEXT NOT NULL,
                battle_date DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ");
    }

    // If DB already existed, ensure 'image' column exists
    if (!$is_new_db) {
        $cols = $pdo->query("PRAGMA table_info('ranking')")->fetchAll(PDO::FETCH_ASSOC);
        $hasImage = false;
        foreach ($cols as $c) {
            if (isset($c['name']) && $c['name'] === 'image') { $hasImage = true; break; }
        }
        if (!$hasImage) {
            try {
                $pdo->exec("ALTER TABLE ranking ADD COLUMN image TEXT");
            } catch (PDOException $e) {
                // ignore if cannot alter (older SQLite?)
            }
        }
    }

} catch (PDOException $e) {
    // 接続失敗時はエラーメッセージをJSONで返して終了
    http_response_code(500); // Internal Server Error
    echo json_encode(['error' => 'データベースに接続できませんでした: ' . $e->getMessage()]);
    exit();
}

// --- リクエストの種類を判断 ---
// GETリクエストの場合はURLのパラメータから、POSTの場合はリクエストボディからactionを取得
$action = $_GET['action'] ?? '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $json_data = file_get_contents('php://input');
    $post_data = json_decode($json_data);
    $action = $post_data->action ?? '';
}

// --- アクションに応じて処理を分岐 ---
switch ($action) {
    case 'save_score':
        saveScore($pdo, $post_data);
        break;
    case 'get_ranking':
        getRanking($pdo);
        break;
    case 'delete_scores':
        deleteScores($pdo, $post_data);
        break;
    case 'clear_all':
        clearAllScores($pdo);
        break;
    case 'save_battle_result':
        saveBattleResult($battle_pdo, $post_data);
        break;
    case 'get_battle_ranking':
        getBattleRanking($battle_pdo);
        break;
    default:
        http_response_code(400); // Bad Request
        echo json_encode(['error' => '無効なアクションです。']);
        break;
}

/**
 * スコアをデータベースに保存する関数
 */
function saveScore($pdo, $data) {
    // nameとscoreが空でないかチェック
    if (empty($data->name) || !isset($data->score)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => '名前またはスコアがありません。']);
        return;
    }

    // 画像があればデコードして src に保存（ファイル名は入力された name を元に png として保存）
    $imageFilename = null;
    if (!empty($data->image) && strpos($data->image, 'data:') === 0) {
        $parts = explode(',', $data->image, 2);
        if (count($parts) === 2) {
            $meta = $parts[0];
            $b64 = $parts[1];
            $decoded = base64_decode($b64);
            if ($decoded !== false) {
                // sanitize provided name to safe filename base
                $rawName = trim($data->name ?? 'player');
                $base = preg_replace('/[^A-Za-z0-9_\-]/', '_', $rawName);
                if ($base === '') $base = 'player';
                $base = mb_substr($base, 0, 32);

                $targetDir = __DIR__ . DIRECTORY_SEPARATOR . 'src';
                if (!is_dir($targetDir)) mkdir($targetDir, 0755, true);

                // target filename: <base>.png, but avoid overwrite by adding suffix
                $candidate = $base . '.png';
                $i = 0;
                while (file_exists($targetDir . DIRECTORY_SEPARATOR . $candidate)) {
                    $i++;
                    $candidate = $base . '_' . $i . '.png';
                    // safety limit
                    if ($i > 1000) break;
                }
                $filePath = $targetDir . DIRECTORY_SEPARATOR . $candidate;

                // Try to convert to PNG using GD if available
                $saved = false;
                if (function_exists('imagecreatefromstring') && function_exists('imagepng')) {
                    $img = @imagecreatefromstring($decoded);
                    if ($img !== false) {
                        // ensure correct PNG saved
                        imagepng($img, $filePath);
                        imagedestroy($img);
                        $saved = true;
                    }
                }
                // fallback: write raw bytes
                if (!$saved) {
                    file_put_contents($filePath, $decoded);
                }
                $imageFilename = $candidate;
            }
        }
    }

    // SQLインジェクションを防ぐため、プリペアドステートメントを使用
    $sql = "INSERT INTO ranking (name, score, image) VALUES (:name, :score, :image)";
    $stmt = $pdo->prepare($sql);

    // パラメータをバインドしてSQLを実行
    $stmt->bindValue(':name', htmlspecialchars($data->name, ENT_QUOTES, 'UTF-8'), PDO::PARAM_STR);
    $stmt->bindValue(':score', (int)$data->score, PDO::PARAM_INT);
    $stmt->bindValue(':image', $imageFilename, PDO::PARAM_STR);

    if ($stmt->execute()) {
        echo json_encode(['success' => true, 'message' => 'スコアを保存しました！', 'image' => $imageFilename]);
    } else {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'スコアの保存に失敗しました。']);
    }
}

/**
 * ランキングデータをデータベースから取得する関数
 */
function getRanking($pdo) {
    // スコアの高い順に上位10件を取得
    $sql = "SELECT id, name, score, image FROM ranking ORDER BY score DESC LIMIT 20";
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    
    // 結果を連想配列として取得
    $ranking = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo json_encode($ranking);
}

/**
 * 選択されたスコアを削除する関数
 */
function deleteScores($pdo, $data) {
    if (empty($data->ids) || !is_array($data->ids)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => '削除対象のIDがありません。']);
        return;
    }
    
    try {
        $placeholders = str_repeat('?,', count($data->ids) - 1) . '?';
        $sql = "DELETE FROM ranking WHERE id IN ($placeholders)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($data->ids);
        
        echo json_encode(['success' => true, 'message' => '選択されたデータを削除しました。']);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => '削除に失敗しました。']);
    }
}

/**
 * すべてのスコアを削除する関数
 */
function clearAllScores($pdo) {
    try {
        $sql = "DELETE FROM ranking";
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        
        echo json_encode(['success' => true, 'message' => 'すべてのデータを削除しました。']);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => '削除に失敗しました。']);
    }
}

/**
 * バトル結果をデータベースに保存する関数
 */
function saveBattleResult($battle_pdo, $data) {
    if (empty($data->player1_name) || empty($data->player2_name) || 
        !isset($data->player1_score) || !isset($data->player2_score) ||
        !isset($data->player1_clicks) || !isset($data->player2_clicks) ||
        !isset($data->player1_final_score) || !isset($data->player2_final_score) ||
        empty($data->winner)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'バトルデータが不完全です。']);
        return;
    }

    try {
        $sql = "INSERT INTO battle_results (
            player1_name, player1_score, player1_clicks, player1_final_score,
            player2_name, player2_score, player2_clicks, player2_final_score,
            winner
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
        
        $stmt = $battle_pdo->prepare($sql);
        $stmt->execute([
            $data->player1_name,
            $data->player1_score,
            $data->player1_clicks,
            $data->player1_final_score,
            $data->player2_name,
            $data->player2_score,
            $data->player2_clicks,
            $data->player2_final_score,
            $data->winner
        ]);
        
        echo json_encode(['success' => true, 'message' => 'バトル結果を保存しました。']);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'バトル結果の保存に失敗しました: ' . $e->getMessage()]);
    }
}

/**
 * バトルランキングを取得する関数
 */
function getBattleRanking($battle_pdo) {
    try {
        // 勝利数でランキングを作成（勝者名でグループ化）
        $sql = "
            SELECT 
                winner as name,
                COUNT(*) as wins,
                MAX(battle_date) as latest_battle
            FROM battle_results 
            WHERE winner != '引き分け'
            GROUP BY winner 
            ORDER BY wins DESC, latest_battle DESC
            LIMIT 50
        ";
        $stmt = $battle_pdo->query($sql);
        $ranking = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo json_encode($ranking);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'バトルランキングの取得に失敗しました: ' . $e->getMessage()]);
    }
}
?>