const { h264_rtsps, h265_rtsps } = require('./config')
const { spawn } = require('child_process')
const https = require('https')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg')

const options = {
    key: fs.readFileSync(`/home/ubuntu/certificates/server.key`, 'utf8'),
    cert: fs.readFileSync(`/home/ubuntu/certificates/server.crt`, 'utf8'),
}
const express = require('express')
const app = express()
const server = https.createServer(options, app)

// 當前 localhost & port
const isExternalIp = false
const localhost = isExternalIp
    ? require('child_process').execSync(`curl -s http://checkip.amazonaws.com || printf "0.0.0.0"`).toString().trim()
    : require('ip').address()
const port = 8080
// 預設最大監聽器數
let defaultMaxListeners = require('events').EventEmitter.defaultMaxListeners
// 每分鐘擷取一次錄影片段
const segmentInSeconds = 60

function encode(rtsp, type) {
    // require('events').EventEmitter.defaultMaxListeners += 1
    const output = `rtsp://${localhost}:9554/live/${rtsp.split('@').pop()}`
    // const process = spawn(
    //     `/usr/local/bin/ffmpeg -rtsp_transport tcp -re -hwaccel cuvid -c:v hevc_cuvid -i ${rtsp} -vcodec h264_nvenc -an -f rtsp -rtsp_transport tcp ${output}`,
    //     {
    //         shell: true,
    //     }
    // )
    // process.stderr.on('data', (data) => {
    //     console.error(`stderr: ${data}`)
    // })
    const command = ffmpeg(rtsp)

    if (type == 'h264') {
        command
            .addInputOption('-rtsp_transport', 'tcp', '-re')
            .addOutputOption(
                '-loglevel',
                'debug',
                '-fps_mode',
                'passthrough',
                '-rtsp_transport',
                'tcp',
                '-preset',
                'medium',
                '-movflags',
                'faststart'
            )
            .output(output)
            .outputFormat('rtsp')
            .videoCodec('copy')
            .noAudio()
            // .on('start', function (command) {
            //     console.log(command)
            // })
            // .on('codecData', function (data) {
            //     console.log('Input is ' + data.audio + ' audio ' + 'with ' + data.video + ' video', rtsp.split('@').pop())
            // })
            .on('stderr', function (err) {
                // console.log(rtsp.split('@').pop(), err)
                if (
                    err
                        .split(' ')
                        .slice(-3, err.length - 1)
                        .join(' ') == 'muxing overhead: unknown'
                ) {
                    encode(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                console.log(rtsp.split('@').pop(), err.message)
                if (err.message == 'Output stream closed') {
                    command.kill()
                }
            })
            .run()
    } else if (type == 'h265') {
        command
            .addInputOption(
                '-rtsp_transport',
                'tcp',
                '-re',
                '-hwaccel',
                'cuda',
                '-hwaccel_output_format',
                'cuda',
                '-c:v',
                'hevc_cuvid'
            )
            .addOutputOption(
                '-fps_mode',
                'passthrough',
                '-rtsp_transport',
                'tcp',
                '-preset',
                'medium',
                '-movflags',
                'faststart'
            )
            .output(output)
            .outputFormat('rtsp')
            .videoCodec('h264_nvenc')
            .noAudio()
            // .on('start', function (command) {
            //     console.log(command)
            // })
            // .on('codecData', function (data) {
            //     console.log('Input is ' + data.audio + ' audio ' + 'with ' + data.video + ' video', rtsp.split('@').pop())
            // })
            .on('stderr', function (err) {
                // console.log(rtsp.split('@').pop(), err)
                if (
                    err
                        .split(' ')
                        .slice(-3, err.length - 1)
                        .join(' ') == 'muxing overhead: unknown'
                ) {
                    encode(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                console.log(rtsp.split('@').pop(), err.message)
                if (err.message == 'Output stream closed') {
                    command.kill()
                }
            })
            .run()
    }
}

app.use(express.static(__dirname))

app.get('/', (req, res) => {
    let videoElements = ''
    const rtsps = h264_rtsps.concat(h265_rtsps)
    rtsps.forEach((rtsp, index) => {
        videoElements += `<video id="video${index}" controls autoplay muted></video>`
    })

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
                reconnectInterval: 2000, // 重連間隔(ms)
                trackingDelta: 2, // 追幀最大延遲
            })
             
            window[\`video\${url.split('/').pop().match(/\\d/g).join('')}\`] = flv.init( 
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
            
            window[\`video\${url.split('/').pop().match(/\\d/g).join('')}\`].play() 
            
            setInterval(()=>{
                player.rebuild()
                console.log('rebuild')
            }, 1000*60*60*24)
        }
 
        const urls = [${rtsps.map((rtsp) => `'wss://${localhost}:9443/live/${rtsp.split('@').pop()}.live.flv'`)}]

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
    const process = spawn(
        `/home/ubuntu/ZLMediaKit/release/linux/Debug/MediaServer -s /home/ubuntu/certificates/ssl.pem`,
        {
            shell: true,
        }
    )
    // process.stdout.on('data', (data) => {
    //     console.log(`stdout: ${data}`)
    // })
    // process.stderr.on('data', (data) => {
    //     console.error(`stderr: ${data}`)
    // })
    // process.on('close', (code) => {
    //     console.log('Child close')
    // })

    if (h264_rtsps.length > 0) {
        h264_rtsps.forEach((rtsp) => {
            encode(rtsp, 'h264')
        })
    }

    if (h265_rtsps.length > 0) {
        h265_rtsps.forEach((rtsp) => {
            encode(rtsp, 'h265')
        })
    }
})
