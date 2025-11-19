import asyncio
import websockets
import cv2
import mediapipe as mp
import numpy as np
import base64
import json
from collections import deque
# ★★★ 正しい protobuf モジュールをインポート ★★★
from mediapipe.framework.formats import landmark_pb2

# --- MediaPipe初期化 ---
mp_holistic = mp.solutions.holistic
mp_drawing = mp.solutions.drawing_utils
holistic = mp_holistic.Holistic(min_detection_confidence=0.5, min_tracking_confidence=0.5, model_complexity=1)

# --- 描画スタイルの定義 (赤色のスティックフィギュア) ---
drawing_spec = mp_drawing.DrawingSpec(color=(0, 0, 255), thickness=2, circle_radius=3)
pose_connections = [
    (12, 11), (11, 23), (23, 24), (24, 12), (11, 13), (13, 15), (12, 14),
    (14, 16), (23, 25), (25, 27), (24, 26), (26, 28)
]

# --- グローバル変数 (安定化処理用) ---
SMOOTHING_FACTOR = 0.3
prev_landmarks = None
prev_timestamps = deque(maxlen=5)
prev_hand_positions = deque(maxlen=5)

# --- ヘルパー関数 ---
def landmarks_to_numpy(landmark_list):
    if not landmark_list or not landmark_list.landmark: return None
    return np.array([[lm.x, lm.y, lm.z, lm.visibility] for lm in landmark_list.landmark])

def calculate_distance_np(p1, p2):
    return np.linalg.norm(p1[:2] - p2[:2])

# --- メイン処理 ---
async def image_processing_handler(websocket, path):
    global prev_landmarks, prev_timestamps, prev_hand_positions
    try:
        async for message in websocket:
            base64_data = message.split(',')[1]
            image_bytes = base64.b64decode(base64_data)
            np_arr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = holistic.process(img_rgb)
            
            # --- 安定化処理 (EMAフィルター) ---
            current_pose_landmarks_np = landmarks_to_numpy(results.pose_landmarks)
            if prev_landmarks is not None and current_pose_landmarks_np is not None and prev_landmarks.shape == current_pose_landmarks_np.shape:
                smoothed_landmarks = SMOOTHING_FACTOR * current_pose_landmarks_np + (1 - SMOOTHING_FACTOR) * prev_landmarks
            else:
                smoothed_landmarks = current_pose_landmarks_np
            prev_landmarks = smoothed_landmarks

            # --- 戦闘力計算ロジック ---

            # --- 測定項目の計算 ---
            height, reach, shoulder, expression, pose, speed_bonus = 0, 0, 0, 0, 0, 0
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
                expression = np.std(face_points)

                # 戦闘力計算例
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

            # --- Python側で画像に直接描画 ---
            annotated_image = cv2.flip(img, 1) # ★★★ 描画前に左右反転 ★★★
            if smoothed_landmarks is not None:
                # ★★★ NumPy配列から正しいlandmark_pb2.NormalizedLandmarkListを再構築 ★★★
                landmark_list_proto = landmark_pb2.NormalizedLandmarkList()
                for lm in smoothed_landmarks:
                    landmark_proto = landmark_list_proto.landmark.add()
                    landmark_proto.x = lm[0]
                    landmark_proto.y = lm[1]
                    landmark_proto.z = lm[2]
                    landmark_proto.visibility = lm[3]

                mp_drawing.draw_landmarks(
                    image=annotated_image,
                    landmark_list=landmark_list_proto,
                    connections=pose_connections,
                    landmark_drawing_spec=drawing_spec,
                    connection_drawing_spec=drawing_spec)

            # --- 描画後の画像をエンコードして送信 ---
            _, buffer = cv2.imencode('.jpg', annotated_image)
            base64_image = base64.b64encode(buffer).decode('utf-8')
            
            response_data = {
                'image': 'data:image/jpeg;base64,' + base64_image,
                'combat_stats': combat_stats
            }
            await websocket.send(json.dumps(response_data))

    except websockets.exceptions.ConnectionClosed:
        print("クライアント接続が切れました。")
    finally:
        prev_landmarks = None

async def main():
    async with websockets.serve(image_processing_handler, "localhost", 8765, max_size=1024*1024*2):
        print("BATTLE INDEX サーバー (最終安定版) が起動しました。")
        await asyncio.Future()

if __name__ == "__main__":
    try: asyncio.run(main())
    except KeyboardInterrupt: print("サーバーを停止します。")