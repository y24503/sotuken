import asyncio
import base64
import json
import socket
import struct
import hashlib
from typing import Optional

# 依存モジュールは可能なら読み込む（無ければフォールバックへ）
try:
    import websockets  # type: ignore
    _HAS_WEBSOCKETS = True
except Exception:
    websockets = None  # type: ignore
    _HAS_WEBSOCKETS = False

try:
    import cv2  # type: ignore
    _HAS_CV2 = True
except Exception:
    cv2 = None  # type: ignore
    _HAS_CV2 = False

try:
    import mediapipe as mp  # type: ignore
    _HAS_MP = True
except Exception:
    mp = None  # type: ignore
    _HAS_MP = False

try:
    import numpy as np  # type: ignore
    _HAS_NP = True
except Exception:
    np = None  # type: ignore
    _HAS_NP = False
# ★★★ 正しい protobuf モジュールをインポート（環境により名前解決できない場合があるためフォールバック） ★★★
try:
    from mediapipe.framework.formats import landmark_pb2  # type: ignore
    _HAS_LMP_PROTO = True
except Exception:
    landmark_pb2 = None  # type: ignore
    _HAS_LMP_PROTO = False

# --- MediaPipe初期化 ---
if _HAS_MP:
    mp_holistic = mp.solutions.holistic
    mp_drawing = mp.solutions.drawing_utils
    # 低遅延のため軽量モデル（complexity=0）を使用
    holistic = mp_holistic.Holistic(
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        model_complexity=0
    )
else:
    mp_holistic = None  # type: ignore
    mp_drawing = None  # type: ignore
    holistic = None  # type: ignore

# --- 描画スタイルの定義 (赤色のスティックフィギュア) ---
if _HAS_MP:
    drawing_spec = mp_drawing.DrawingSpec(color=(0, 0, 255), thickness=2, circle_radius=3)
else:
    drawing_spec = None
pose_connections = [
    (12, 11), (11, 23), (23, 24), (24, 12), (11, 13), (13, 15), (12, 14),
    (14, 16), (23, 25), (25, 27), (24, 26), (26, 28)
]

# --- グローバル変数 (安定化処理用) ---
SMOOTHING_FACTOR = 0.3
# --- フェアモード設定（身長の影響を抑制） ---
FAIR_MODE = True
FAIR_CLIP_MAX = 1.2  # reach/height, shoulder/height のクリップ上限
prev_landmarks = None

# --- 低遅延設定（処理・転送の軽量化）---
LOW_LATENCY = True
TARGET_WIDTH = 480   # 推論・返却に使う最大幅（これ以上なら縮小）
JPEG_QUALITY = 60    # 返却画像の JPEG 品質（低いほど転送量↓）

# サーバー側オーバーレイはオフ（描画負荷を避ける）
DRAW_OVERLAY = False

# 低遅延時はスムージング遅延を抑える
if LOW_LATENCY:
    SMOOTHING_FACTOR = 0.7

# --- 表示制御（サーバー側オーバーレイを描画しない）---
DRAW_OVERLAY = False

# --- ヘルパー関数 ---
def landmarks_to_numpy(landmark_list):
    if not landmark_list or not getattr(landmark_list, 'landmark', None):
        return None
    if not _HAS_NP:
        return None
    return np.array([[lm.x, lm.y, lm.z, lm.visibility] for lm in landmark_list.landmark])  # type: ignore

def calculate_distance_np(p1, p2):
    if not _HAS_NP:
        return 0.0
    return np.linalg.norm(p1[:2] - p2[:2])  # type: ignore

# --- メイン処理 ---
async def image_processing_handler(websocket, _path):
    global prev_landmarks
    try:
        async for message in websocket:
            base64_data = message.split(',')[1]
            image_bytes = base64.b64decode(base64_data)
            np_arr = np.frombuffer(image_bytes, np.uint8)  # type: ignore
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)  # type: ignore
            # 解像度を縮小（低遅延オプション）
            if LOW_LATENCY and img is not None:
                try:
                    h0, w0 = img.shape[:2]
                    if w0 > TARGET_WIDTH:
                        scale = TARGET_WIDTH / float(w0)
                        new_w = int(w0 * scale)
                        new_h = int(h0 * scale)
                        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)  # type: ignore
                except Exception:
                    pass
            
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # type: ignore
            results = holistic.process(img_rgb)  # type: ignore
            
            # --- 安定化処理 (EMAフィルター) ---
            current_pose_landmarks_np = landmarks_to_numpy(results.pose_landmarks)
            if prev_landmarks is not None and current_pose_landmarks_np is not None and prev_landmarks.shape == current_pose_landmarks_np.shape:
                smoothed_landmarks = SMOOTHING_FACTOR * current_pose_landmarks_np + (1 - SMOOTHING_FACTOR) * prev_landmarks
            else:
                smoothed_landmarks = current_pose_landmarks_np
            prev_landmarks = smoothed_landmarks

            # --- 測定項目の計算 ---
            height, reach, shoulder, expression, pose, speed_bonus = 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
            # スコア項目の初期化（ランドマーク未検出フレーム対策）
            height_score = 0.0
            reach_score = 0.0
            shoulder_score = 0.0
            pose_bonus = 0.0
            expression_bonus = 0.0
            base_power = 0.0
            total_power = 0.0
            if smoothed_landmarks is not None and len(smoothed_landmarks) > 32:
                # 身長: 頭頂(0)と両足首(29,30)のy座標差
                height = abs(smoothed_landmarks[0][1] - (smoothed_landmarks[29][1] + smoothed_landmarks[30][1]) / 2)
                # リーチ: 両手首(15,16)の距離
                reach = calculate_distance_np(smoothed_landmarks[15], smoothed_landmarks[16])
                # 肩幅: 両肩(11,12)の距離
                shoulder = calculate_distance_np(smoothed_landmarks[11], smoothed_landmarks[12])
                # 姿勢: 背骨(24,23)と首(0)の直線距離（体の直立度合い）
                pose = calculate_distance_np(smoothed_landmarks[0], (smoothed_landmarks[23] + smoothed_landmarks[24]) / 2)
                # 表情: 顔のランドマーク(0,1,2,3,4)の分散（仮の指標）
                face_points = smoothed_landmarks[0:5, :2]
                if _HAS_NP:
                    expression = np.std(face_points)  # type: ignore
                else:
                    expression = 0.0

                # スコア計算（フェアモード：身長起因の差を低減）
                if FAIR_MODE:
                    eps = 1e-6
                    h = max(float(height), eps)
                    reach_norm = float(reach) / h
                    shoulder_norm = float(shoulder) / h
                    # 外れ値抑制
                    if _HAS_NP:
                        reach_norm = float(np.clip(reach_norm, 0.0, FAIR_CLIP_MAX))  # type: ignore
                        shoulder_norm = float(np.clip(shoulder_norm, 0.0, FAIR_CLIP_MAX))  # type: ignore
                    else:
                        reach_norm = min(max(reach_norm, 0.0), FAIR_CLIP_MAX)
                        shoulder_norm = min(max(shoulder_norm, 0.0), FAIR_CLIP_MAX)
                    # 逓減（過度な差を抑える）
                    reach_score = (reach_norm ** 0.5) * 120000
                    shoulder_score = (shoulder_norm ** 0.5) * 80000
                    height_score = 0.0  # 身長スコアは加えない
                    pose_bonus = pose * 50000
                    expression_bonus = expression * 30000
                    base_power = height_score + reach_score + shoulder_score
                else:
                    # 旧ロジック
                    height_score = height * 100000
                    reach_score = reach * 150000
                    shoulder_score = shoulder * 80000
                    pose_bonus = pose * 50000
                    expression_bonus = expression * 30000
                    base_power = height_score + reach_score + shoulder_score
                total_power = base_power + pose_bonus + expression_bonus + speed_bonus

            combat_stats = {
                'base_power': round(base_power),
                'pose_bonus': round(pose_bonus),
                'expression_bonus': round(expression_bonus),
                'speed_bonus': round(speed_bonus),
                'total_power': round(total_power),
                'height': float(height),
                'reach': float(reach),
                'shoulder': float(shoulder),
                'expression': float(expression),
                'pose': float(pose)
            }

            # --- Python側でのオーバーレイ描画（無効: 画像はそのまま送出） ---
            annotated_image = img.copy()
            if DRAW_OVERLAY and smoothed_landmarks is not None:
                if _HAS_LMP_PROTO:
                    landmark_list_proto = landmark_pb2.NormalizedLandmarkList()  # type: ignore[attr-defined]
                    for lm in smoothed_landmarks:
                        landmark_proto = landmark_list_proto.landmark.add()
                        landmark_proto.x = lm[0]
                        landmark_proto.y = lm[1]
                        landmark_proto.z = lm[2]
                        landmark_proto.visibility = lm[3]
                    mp_drawing.draw_landmarks(  # type: ignore
                        image=annotated_image,
                        landmark_list=landmark_list_proto,
                        connections=pose_connections,
                        landmark_drawing_spec=drawing_spec,
                        connection_drawing_spec=drawing_spec)
                else:
                    h, w = annotated_image.shape[:2]
                    pts = (smoothed_landmarks[:, :2] * np.array([w, h])).astype(int)  # type: ignore
                    color = (0, 0, 255)
                    for a, b in pose_connections:
                        if 0 <= a < len(pts) and 0 <= b < len(pts):
                            pa, pb = tuple(pts[a]), tuple(pts[b])
                            cv2.line(annotated_image, pa, pb, color, 2)  # type: ignore
                    for p in pts:
                        cv2.circle(annotated_image, tuple(p), 3, color, -1)  # type: ignore

            # 最後に左右反転（フロントカメラ見え方に合わせる）
            annotated_image = cv2.flip(annotated_image, 1)  # type: ignore

            # --- 描画後の画像をエンコードして送信 ---
            # 軽量JPEGでエンコード（低遅延時は品質を下げて転送量を削減）
            if LOW_LATENCY:
                try:
                    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), int(JPEG_QUALITY)]  # type: ignore
                    _, buffer = cv2.imencode('.jpg', annotated_image, encode_params)  # type: ignore
                except Exception:
                    _, buffer = cv2.imencode('.jpg', annotated_image)  # type: ignore
            else:
                _, buffer = cv2.imencode('.jpg', annotated_image)  # type: ignore
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            response_data = {
                'image': 'data:image/jpeg;base64,' + base64_image,
                'combat_stats': combat_stats
            }
            await websocket.send(json.dumps(response_data))

    except Exception:
        print("クライアント接続が切れました。")
    finally:
        prev_landmarks = None

async def main_ws():
    # websockets ライブラリが使える場合の通常モード
    async with websockets.serve(image_processing_handler, "localhost", 8765, max_size=1024*1024*2):  # type: ignore
        mode = "フェアモード" if FAIR_MODE else "通常モード"
		print(f"JSOK サーバー ({mode}) [websockets] が起動しました。")
        await asyncio.Future()

# ----------------------
# フォールバック: 純標準ライブラリの簡易WebSocketサーバー
# ----------------------
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("socket closed")
        buf += chunk
    return buf

def _read_ws_frame(sock: socket.socket) -> Optional[str]:
    # テキストフレームのみ対応
    header = _recv_exact(sock, 2)
    b1, b2 = header[0], header[1]
    opcode = b1 & 0x0F
    masked = (b2 & 0x80) != 0
    length = b2 & 0x7F
    if opcode == 0x8:
        return None  # close
    if length == 126:
        length = struct.unpack("!H", _recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", _recv_exact(sock, 8))[0]
    mask = _recv_exact(sock, 4) if masked else b"\x00\x00\x00\x00"
    payload = _recv_exact(sock, length)
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return payload.decode("utf-8", errors="ignore")

def _send_ws_text(sock: socket.socket, text: str) -> None:
    data = text.encode("utf-8")
    header = bytearray()
    header.append(0x81)  # FIN + text frame
    n = len(data)
    if n <= 125:
        header.append(n)
    elif n < 65536:
        header.append(126)
        header.extend(struct.pack("!H", n))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", n))
    sock.sendall(header + data)

def run_minimal_ws_server(host: str = "localhost", port: int = 8765) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((host, port))
        s.listen(1)
        print("JSOK サーバー [fallback] が起動しました。依存なし簡易モードです。")
        while True:
            conn, _ = s.accept()
            with conn:
                # ハンドシェイク
                request = b""
                while b"\r\n\r\n" not in request:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    request += chunk
                req_text = request.decode("utf-8", errors="ignore")
                lines = req_text.split("\r\n")
                headers = {}
                for line in lines[1:]:
                    if ": " in line:
                        k, v = line.split(": ", 1)
                        headers[k.lower()] = v
                key = headers.get("sec-websocket-key", "")
                accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
                resp = (
                    "HTTP/1.1 101 Switching Protocols\r\n"
                    "Upgrade: websocket\r\n"
                    "Connection: Upgrade\r\n"
                    f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
                )
                conn.sendall(resp.encode())

                # メッセージループ（テキストフレームのみ）
                while True:
                    msg = _read_ws_frame(conn)
                    if msg is None:
                        break
                    # クライアントからの data URL をそのまま返す簡易エコー
                    combat_stats = {
                        'base_power': 0,
                        'pose_bonus': 0,
                        'expression_bonus': 0,
                        'speed_bonus': 0,
                        'total_power': 0,
                        'height': 0.0,
                        'reach': 0.0,
                        'shoulder': 0.0,
                        'expression': 0.0,
                        'pose': 0.0
                    }
                    response_data = {
                        'image': msg.strip(),
                        'combat_stats': combat_stats
                    }
                    _send_ws_text(conn, json.dumps(response_data))

if __name__ == "__main__":
    try:
        if _HAS_WEBSOCKETS and _HAS_CV2 and _HAS_MP and _HAS_NP:
            asyncio.run(main_ws())
        else:
            run_minimal_ws_server()
    except KeyboardInterrupt:
        print("サーバーを停止します。")
