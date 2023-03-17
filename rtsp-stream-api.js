const { rtsps } = require('./config')
const https = require('https')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
ffmpeg.setFfmpegPath('/usr/bin/ffmpeg')

const options = {
    key: fs.readFileSync(`/home/ubuntu/rtsp-api/go-oryx/httpx-static/server.key`, 'utf8'),
    cert: fs.readFileSync(`/home/ubuntu/rtsp-api/go-oryx/httpx-static/server.crt`, 'utf8'),
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
const localhost = require('child_process')
    .execSync(`curl -s http://checkip.amazonaws.com || printf "0.0.0.0"`)
    .toString()
    .trim()
// cores
const cores = Math.floor(require('os').cpus().length / 5)
// 預設最大監聽器數
let defaultMaxListeners = require('events').EventEmitter.defaultMaxListeners

function encode(rtsp, size, stream) {
    require('events').EventEmitter.defaultMaxListeners += 2

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
            // '-threads',
            // 1,
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

        .on('stderr', function (err) {
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
        })
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
    <script src="https://cdnjs.cloudflare.com/ajax/libs/flv.js/1.6.2/flv.min.js" integrity="sha512-49OFf+8jaHx4Vb7iFNb46Loq1pIxXlEYeVOQRIx0KLBRF4KSV6E7QK2Vw5r416TQDyBJW+DFh2CyTV7+gCWd6g==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    ${videoElements}
    <script>
        function init(url, rtsp, element){
            if (flvjs.isSupported()) {
                let player = flvjs.createPlayer(
                    {
                        type: "flv",
                        isLive: true,
                        hasAudio: false,
                        url: url,
                    },
                    {
                        enableWorker: false, // 不啟用分離線程
                        enableStashBuffer: false, // 關閉IO隱藏緩衝區
                        isLive: true,
                        lazyLoad: false,
                        deferLoadAfterSourceOpen: false
                    }
                )
                player.attachMediaElement(element)
                player.load()
                player.play()

                // 串流延遲
                const delayCorrector = setInterval(() => {
                    if (player.buffered.length) {
                        let end = player.buffered.end(0) // 獲取當前buffered值
                        let diff = end - player.currentTime // 獲取buffered與currentTime的差值

                        if (diff >= 0.5) {
                            //如果差值大於等於0.5 手動跳幀 這裡可根據自身需求來定
                            player.currentTime = player.buffered.end(0) //手動跳幀
                        }
                    }
                }, 2000) // 2000毫秒執行一次

                // 斷線重連
                player.on(flvjs.Events.ERROR, (errorType, errorDetail, errorInfo) => {
                    console.log("errorType:", errorType)
                    console.log("errorDetail:", errorDetail)
                    console.log("errorInfo:", errorInfo)

                    // 視頻出錯後銷毀重新創建
                    if (player) {
                        player.pause()
                        player.unload()
                        player.detachMediaElement()
                        player.destroy()
                        player = null
                        clearInterval(delayCorrector)
                        init(url, rtsp, element)
                        console.log('%c斷線重連', 'background:green;color:#fff',rtsp)
                    }
                })
                
                // 畫面卡死
                player.on("statistics_info", function (res) {
                    if (this.lastDecodedFrame == 0) {
                        this.lastDecodedFrame = res.decodedFrames
                        return
                    }

                    if (this.lastDecodedFrame != res.decodedFrames) {
                        this.lastDecodedFrame = res.decodedFrames
                    } else {
                        this.lastDecodedFrame = 0
 
                        if (player) {
                            player.pause()
                            player.unload()
                            player.detachMediaElement()
                            player.destroy()
                            player = null
                            clearInterval(delayCorrector)
                            init(url, rtsp, element)
                            console.log('%c畫面卡死', 'background:red;color:#fff',rtsp)
                        }
                    }
                })
            } else {
                console.log("不支持的格式")
                return
            }
            
        }

        const rtsps = [${rtsps.map((rtsp) => `'${rtsp}'`)}]
      
        rtsps.forEach((rtsp, index)=>{ 
            const size = 100
            const rtspUrl = \`rtsp://${localhost}:${port}/\${rtsp.split('@').pop().replace(/\:+/g, '-')}\`
            const url = \`wss://${localhost}:${port}/rtsp?url=\${window.btoa(rtspUrl)}&size=\${size}\`
            const element = document.getElementById(\`video\${index}\`)
            init(url, rtsp, element)
        })

        setInterval(()=>console.clear(),1000*60*5) // clear logs every 5 minutes
    </script>
`)
})

server.listen(port, () => {
    rtsps.forEach((rtsp) => {
        require('events').EventEmitter.defaultMaxListeners += 1
        const output = `rtsp://${localhost}:${port}/${rtsp.split('@').pop().replace(/\:+/g, '-')}`
        const command = ffmpeg(rtsp)
        command
            .addInputOption('-rtsp_transport', 'tcp')
            .addOutputOption('-rtsp_transport', 'tcp', '-c:v', 'copy')
            .outputFormat('rtsp')
            .noAudio()
            .on('start', function (command) {
                console.log(command)
            })
            .on('error', function (err, stdout, stderr) {
                if (err.message == 'Output stream closed') {
                    command.kill()
                }
            })
            .output(output)
            .run()
    })
})
