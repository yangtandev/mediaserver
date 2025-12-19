import os
import cv2

# --- 強制使用 TCP 的關鍵設定 ---
# 在呼叫 cv2.VideoCapture 之前設定環境變數
# 格式為 "key;value"
# 增加分析時間與探測大小，處理不標準的串流
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport:tcp|analyzeduration:5000000|probesize:5000000"

rtsp_url = "rtsp://your_camera_source_url" # 換成您的母流 URL

# 建立 VideoCapture 物件，它會自動讀取上面的環境變數
# 明確指定使用 FFmpeg 後端是個好習慣
cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)

if not cap.isOpened():
    print("錯誤：無法開啟影像串流。")
    print("請檢查：")
    print("1. URL 是否正確。")
    print("2. 攝影機是否在線上。")
    print("3. 網路連線是否正常。")
else:
    print("成功開啟影像串流，並已強制使用 TCP 傳輸。")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("串流結束或讀取錯誤。")
            break

        # 在這裡處理您的影像幀 (frame)
        cv2.imshow('RTSP Stream (TCP)', frame)

        # 按 'q' 鍵退出
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

# 釋放資源
cap.release()
cv2.destroyAllWindows()

# 清除環境變數（好習慣）
del os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"]
