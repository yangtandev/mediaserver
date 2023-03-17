const { rtsps } = require('./config')
const https = require('https')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg')

const options = {
    key: fs.readFileSync(`/home/ubuntu/rtsp-api/go-oryx/httpx-static/server.key`, 'utf8'),
    cert: fs.readFileSync(`/home/ubuntu/rtsp-api/go-oryx/httpx-static/server.crt`, 'utf8'),
}
const express = require('express')
const app = express()
const server = https.createServer(options, app)

const { spawn } = require('child_process')
// 當前 localhost & port
const isExternalIp = false
const localhost = isExternalIp
    ? require('child_process').execSync(`curl -s http://checkip.amazonaws.com || printf "0.0.0.0"`).toString().trim()
    : require('ip').address()
const port = 2000
// cores
const cores = Math.floor(require('os').cpus().length / 5)
// 預設最大監聽器數
let defaultMaxListeners = require('events').EventEmitter.defaultMaxListeners

function encode(rtsp) {
    require('events').EventEmitter.defaultMaxListeners += 1
    const output = `rtmp://${localhost}:1935/live/${rtsp.split('@').pop()}`
    const command = ffmpeg(rtsp)
    command
        .addInputOption(
            '-analyzeduration', // 碼流分析時間設置，單位為微秒
            0,
            '-rtsp_transport',
            'tcp',
            '-re'
        )
        .output(output)
        .outputFormat('flv') // 轉換為flv格式
        .videoCodec('libx264') // ffmpeg無法直接將h265轉換為flv的，故需要先將h265轉換為h264，然後再轉換為flv
        .noAudio()
        .on('error', function (err, stdout, stderr) {
            if (err.message == 'Output stream closed') {
                command.kill()
            }
        })
        .run()
}

app.use(express.static(__dirname))

app.get('/', (req, res) => {
    let videoElements = ''
    rtsps.forEach((rtsp, index) => (videoElements += `<video id="video${index}" controls autoplay muted></video>`))

    res.send(`
    <script src="./lib/flvExtend.js" charset="utf-8"></script>
    <script src="./lib/reconnecting-websocket.js" charset="utf-8"></script>
    ${videoElements}
    <script>
        function init(url, element){
            const flv = new FlvExtend({
                element: element,
                frameTracking: true, // 追幀設置
                updateOnStart: true, // 點擊播放按鈕後實時更新視頻
                updateOnFocus: true, // 回到前台後實時更新 
                reconnect: true, // 斷流後重連
                reconnectInterval: 0, // 重連間隔(ms)
                trackingDelta: 2, // 追幀最大延遲
            })
             
            const player = flv.init( 
                {
                    type: 'flv', 
                    url: url, 
                    isLive: true,
                    hasAudio: false,
                    withCredentials: false, 
                },
                {
                    enableStashBuffer: false, // 是否啟用IO隱藏緩衝區。如果您需要實時（最小延遲）來進行實時流播放，則設置為false
                    autoCleanupSourceBuffer: true, // 對SourceBuffer進行自動清理
                    stashInitialSize: 128 // 減少首幀顯示等待時長
                }
            )
            let counter = 0
            
            player.play() 
            setInterval(()=>{
                player.rebuild()
                console.log('rebuild')
            }, 1000*60*60*24)
        }

        
        const urls = [${rtsps.map((rtsp) => `'https://${localhost}:8088/live/${rtsp.split('@').pop()}.flv'`)}]
        
        urls.forEach((url, index)=>{ 
            const element = document.getElementById(\`video\${index}\`)
            init(url, element)
        })

        setInterval(()=>console.clear(),1000*60*5) // clear logs every 5 minutes
    </script>
`)
})

server.listen(port, () => {
    console.log(`https://${localhost}:${port}`)
    spawn(`CANDIDATE="${localhost}" && cd /home/ubuntu/rtsp-api/srs/trunk && ./objs/srs -c conf/https.flv.live.conf`, {
        shell: true,
    })

    setTimeout(() => {
        rtsps.forEach((rtsp) => {
            encode(rtsp)
        })
    }, 0)
})
