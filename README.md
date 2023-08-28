# 快速開始

## 建議硬體配置

-   Memory: 16 GB 以上
-   Processor: 13th Gen Intel® Core™ i7-13700 x 24 以上
-   Graphics: GeForce GTX 1080 Ti 11GB 以上
-   Disk Capacity: 6.0 TB 以上
-   OS Name: Ubuntu 22.04.3 LTS
-   OS Type: 64-bit

## 環境需求

-   Node.js: 14.16.1 (LTS)  
     (請使用 nvm 安裝 Node.js: https://github.com/nvm-sh/nvm)
-   PM2: Latest version
-   NVIDIA Display Driver: 535.86.10
-   CUDA Toolkit: 12.2  
    (NVIDIA Driver & CUDA 安裝可參考: https://jackfrisht.medium.com/install-nvidia-driver-via-ppa-in-ubuntu-18-04-fc9a8c4658b9)
-   NVIDIA-Patch: Latest version  
    (此為破解顯卡影像編碼最大限制的補丁，安裝可參考: https://github.com/keylase/nvidia-patch)
-   FFMpeg: Latest version  
    (FFMpeg 安裝可參考: https://docs.nvidia.com/video-technologies/video-codec-sdk/12.0/ffmpeg-with-nvidia-gpu/index.html)
-   ZLMediaKit: Latest version  
    (進入 $home/NVR/ZLMediaKit，並按照以下教程開始安裝編譯器、依賴庫、構建和編譯項目: https://github.com/ZLMediaKit/ZLMediaKit/wiki/%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B)

## 啟動程式

-   pm2 start ecosystem.config.js
-   pm2 save (記得先使用 pm2 startup 設定開機自動啟動 pm2)

## 功能介紹

1. 自訂的客戶列表: 可按照需求加入客戶的攝影機串流資訊，包括 RTMP、RTSP(H264 或 HEVC)等協議。  
   (https://stream.ginibio.com/client-list 或 http://your_local_ip:9080/client-list)
2. 自動影像串流備分: 按日期、客戶作分類，可依需求線上瀏覽或直接下載影像檔。  
   (https://stream.ginibio.com/客戶名/backup 或 http://your_local_ip:9080/客戶名/backup)
3. NVR 即時影像串流預覽: 可觀看註冊於 client-list 頁中的客戶的攝影機影像串流。  
   (https://stream.ginibio.com/nvr 或 http://your_local_ip:9080/nvr)

## 備註

如需切換成 HTTP 協議，可直接於下列路徑的檔案中，將註解為 // HTTP 的代碼開啟，同時註解掉 // HTTPS 的代碼，最後於終端機使用指令 "pm2 reload nvr" 以重整系統:

-   $HOME/NVR/index.js
-   $HOME/NVR/ZLMediaKit/release/linux/Debug/www/nvr/index.html
-   $HOME/NVR/ZLMediaKit/release/linux/Debug/www/client-list/index.html
