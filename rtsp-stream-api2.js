const { rtsps } = require('./config')
const https = require('https')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
ffmpeg.setFfmpegPath('/usr/bin/ffmpeg')

const options = {
    key: fs.readFileSync('./certificates/privkey.pem', 'utf8'),
    cert: fs.readFileSync('./certificates/fullchain.pem', 'utf8'),
    ca: fs.readFileSync('./certificates/chain.pem', 'utf8'),
}
const express = require('express')
const expressWs = require('express-ws')
const app = express()
const server = https.createServer(options, app)
expressWs(app, server, {
    perMessageDeflate: false,
})

const webSocketStream = require('websocket-stream/stream')

const port = 2000
// 當前 ip
const ip = require('child_process')
    .execSync(`curl -s http://checkip.amazonaws.com || printf "0.0.0.0"`)
    .toString()
    .trim()
// cores
const cores = Math.floor(require('os').cpus().length / 5)
// 預設最大監聽器數
let defaultMaxListeners = require('events').EventEmitter.defaultMaxListeners

function encode(rtsp, size, stream) {
    require('events').EventEmitter.defaultMaxListeners += 1

    const command = ffmpeg(rtsp)
    command
        .addInputOption(
            '-analyzeduration', // 碼流分析時間設置，單位為微秒
            0,
            '-rtsp_transport',
            'tcp',
            '-re'
        )
        .addOutputOption(
            '-threads',
            1,
            '-movflags', // 把MOV/MP4文件的索引信息放到文件前面以支持邊下邊播
            'faststart',
            '-tune',
            'zerolatency',
            '-preset', // 選項集合，以編碼速度來決定壓縮比
            'medium',
            '-crf', // 自動分配位元速率
            28
        )
        .outputFormat('flv') // 轉換為flv格式
        .videoCodec('libx264') // ffmpeg無法直接將h265轉換為flv的，故需要先將h265轉換為h264，然後再轉換為flv
        .withSize(`${size}%`) // 轉換之後的視頻分辨率原來的50%, 如果轉換出來的視頻仍然延遲高，可按照文檔上面的描述，自行降低分辨率
        .noAudio() // 去除聲音

        // .on('stderr', function (err) {
        // if (err.split(' ').slice(-3).join(',').replace(/,+/g, ' ') == 'muxing overhead: unknown') {
        //     setTimeout(() => {
        //         console.log('stderr encoding error')
        //         rtspToFlvHandle(ws, req)
        //     }, 10000)
        // }
        // if (err.split(' ').slice(-7, -1).join(',').replace(/,+/g, ' ') == 'Could not find ref with POC') {
        //     command.kill()
        //     encode(rtspUrl, size)
        //     console.log('POC restart')
        // }
        // console.log(err.split(' '))
        // })
        .on('error', function (err, stdout, stderr) {
            // if (err.message.split(' ').slice(-4, -3).shift() === '5XX') {
            //     encode(rtspUrl, size)
            //     console.log('5XX restart')
            // }
            if (err.message == 'Output stream closed') {
                command.kill()
            }
        })
        .pipe(stream)
}

/**
 * rtsp 轉換 flv 的處理函數
 * @param ws
 * @param req
 */
function rtspToFlvHandle(ws, req) {
    // 心跳重連
    const heartCheck = {
        timeout: 60000, //60ms
        timeoutObj: null,
        serverTimeoutObj: null,
        reset: function () {
            clearTimeout(this.timeoutObj)
            clearTimeout(this.serverTimeoutObj)
            this.start()
        },
        start: function () {
            var self = this
            this.timeoutObj = setTimeout(function () {
                ws.send('HeartBeat')
                self.serverTimeoutObj = setTimeout(function () {
                    ws.close() //如果onclose會執行reconnect，我們執行ws.close()就行了.如果直接執行reconnect 會觸發onclose導致重連兩次
                }, self.timeout)
            }, this.timeout)
        },
    }

    ws.onopen = function () {
        heartCheck.start()
    }
    ws.onmessage = function (event) {
        heartCheck.reset()
    }
    ws.onclose = function () {
        console.log(reconnect)
        reconnect()
    }
    ws.onerror = function () {
        reconnect()
    }

    const stream = webSocketStream(
        ws,
        {
            binary: true,
            browserBufferTimeout: 1000000,
        },
        {
            browserBufferTimeout: 1000000,
        }
    )

    const { url, size } = req.query
    const rtsp = Buffer.from(url, 'base64').toString()

    encode(rtsp, size, stream)
}

app.use(express.static(__dirname))

app.ws('/rtsp', rtspToFlvHandle)

app.get('/', (req, res) => {
    let videoElements = ''
    rtsps.forEach((rtsp, index) => (videoElements += `<video id="video${index}" controls autoplay muted></video>`))

    res.send(`
    <script src="./lib/flvExtend.js" charset="utf-8"></script>
    <script src="./lib/reconnecting-websocket.js" charset="utf-8"></script>
    ${videoElements}
    <script>
        function init(url, rtsp, element){
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

        const rtsps = [${rtsps.map((rtsp) => `'${rtsp}'`)}]
      
        rtsps.forEach((rtsp, index)=>{ 
            const size = 100
            const url = \`wss://${ip}:${port}/rtsp?url=\${window.btoa(rtsp)}&size=\${size}\`
            const element = document.getElementById(\`video\${index}\`)
            init(url, rtsp, element)
        })

        setInterval(()=>console.clear(),1000*60*5) // clear logs every 5 minutes
    </script>
`)
})

server.listen(port)
