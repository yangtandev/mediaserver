## 快速啟動
- 獲取原碼並執行自動安裝檔，Mediaserver 將於安裝完成後自動啟動。  
```
git clone https://github.com/yangtandev/mediaserver.git
sudo chmod +x $HOME/mediaserver/setup_mediaserver.sh
$HOME/mediaserver/setup_mediaserver.sh
```
- 需要 Frame Animation 功能，請執行以下代碼:
``` 
pm2 start $HOME/mediaserver/rtsp-to-image.js --time && pm2 start $HOME/mediaserver/websocket-server.js --time && pm2 save
```
- 需要縮時攝影功能，請執行以下代碼 (依賴 Frame Animation 功能):
```
pm2 start $HOME/mediaserver/collect-images.js --time && pm2 save
```
要手動觸發縮時影片的生成，請訪問以下網址 (這會為所有已設定的攝影機觸發生成):
`http://localhost:4000/generateTimeLapse`
## 環境需求

-   Git: Latest version
-   Node.js: 14.16.1 (LTS)  or later  
    請使用 nvm 安裝 Node.js: https://github.com/nvm-sh/nvm
-   ZLMediaKit: Latest version  
    按照以下教程開始安裝編譯器、依賴庫、構建和編譯項目: https://github.com/ZLMediaKit/ZLMediaKit/wiki/%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B
-   Nginx: Latest version ( For HTTPS )  
    安裝可參考: https://www.digitalocean.com/community/tutorials/how-to-install-nginx-on-ubuntu-22-04
-   Certbot: Latest version ( For HTTPS )  
    安裝及申請憑證可參考: https://certbot.eff.org/instructions?ws=nginx&os=ubuntufocal  
    完成後，請於 /etc/nginx/sites-enabled/default 中，找到 listen 443 ssl 的 server，並在裡面加入:

    ```
    location /mediaserver/ {
        proxy_pass http://localhost:9080/;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    }
    
    location /api/ {
        proxy_pass http://localhost:3000/;
    }

    location /ws {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
    ```

    最後，使用終端機輸入以下指令，以使新配置生效:

    ```
    sudo /etc/init.d/nginx restart
    ```

## 功能介紹

1. 自訂的客戶列表(config): 可按照需求加入客戶的攝影機串流資訊，支援包括 RTMP、RTSP( H264 及 HEVC )等協議。  
   http://localhost:9080/config
2. 自動影像串流備分: 按日期、客戶作分類，可依需求線上瀏覽或直接下載影像檔。  
   http://localhost:9080/your_client_name/backup
3. 即時串流影像預覽(cctv): 可觀看註冊於 config 頁中的客戶的攝影機影像串流。  
   http://localhost:9080/cctv
4. 縮時攝影(Time-lapse): 自動收集排程的影像截圖，並提供功能以將其合成為縮時影片。
   - 影像收集資料夾: http://localhost:9080/time-lapse/backup/image/
   - 縮時影片資料夾: http://localhost:9080/time-lapse/backup/video/
