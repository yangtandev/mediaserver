const { spawn } = require('child_process')
const { h264_rtsps, h265_rtsps } = require('./config')
const rtsps = h264_rtsps.concat(h265_rtsps)
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
const isExternalIp = false
const localhost = isExternalIp
    ? require('child_process').execSync(`curl -s http://checkip.amazonaws.com || printf "0.0.0.0"`).toString().trim()
    : require('ip').address()
const port = 8080
const segmentInSeconds = 60 // 每分鐘擷取一次錄影片段
let defaultMaxListeners = require('events').EventEmitter.defaultMaxListeners // 預設最大監聽器數

const RTSPCommands = {}
const MP4Commands = {}

function RTSPToRTSP(rtsp, type) {
    require('events').EventEmitter.defaultMaxListeners += 2

    const output = `rtsp://${localhost}:9554/live/${rtsp.split('@').pop()}`
    RTSPCommands[getVariableName(rtsp)] = ffmpeg(rtsp)

    if (type == 'h264') {
        RTSPCommands[getVariableName(rtsp)]
            .addInputOption('-rtsp_transport', 'tcp', '-re')
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
            .videoCodec('copy')
            .noAudio()
            .on('stderr', function (err) {
                // console.log(rtsp.split('@').pop(), err)
                err = err
                    .split(' ')
                    .slice(-3, err.length - 1)
                    .join(' ')

                if (err == 'muxing overhead: unknown' || err == '404 Not Found') {
                    RTSPToRTSP(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                console.log(rtsp.split('@').pop(), err.message)
                if (err.message == 'Output stream closed') {
                    RTSPCommands[getVariableName(rtsp)].kill()
                }
            })
            .run()
    } else if (type == 'h265') {
        RTSPCommands[getVariableName(rtsp)]
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
            .on('stderr', function (err) {
                console.log('stderr', err)
                // console.log(rtsp.split('@').pop(), err)
                err = err
                    .split(' ')
                    .slice(-3, err.length - 1)
                    .join(' ')

                if (err == 'muxing overhead: unknown' || err == '404 Not Found') {
                    RTSPToRTSP(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                // console.log('error', err.message)
                // console.log(rtsp.split('@').pop(), err.message)
                if (err.message == 'Output stream closed') {
                    RTSPCommands[getVariableName(rtsp)].kill()
                }
            })
            .run()
    }
}

function MP4ToMP4(rtsp) {
    const ip = rtsp.split('@').pop()
    const today = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .replace(/\:+/g, '-')
        .slice(0, 10)

    let dir = `/mnt/d/backup`

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir)
    }

    dir = `${dir}/${today}`

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir)
    }

    dir = `${dir}/${ip}`

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir)
    }
    const mp4 = `http://${localhost}:9080/live/${rtsp.split('@').pop()}.live.mp4`

    require('events').EventEmitter.defaultMaxListeners += 2

    const now = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .replace(/\:+/g, '-')
        .slice(0, -5)
        .split('T')
        .join(' ')
    MP4Commands[getVariableName(rtsp)] = ffmpeg(mp4)

    MP4Commands[getVariableName(rtsp)]
        .addInputOption(
            '-analyzeduration', // 碼流分析時間設置，單位為微秒
            0
        )
        .addOutputOption('-preset', 'medium', '-movflags', 'faststart', '-t', segmentInSeconds)
        .outputFormat('mp4')
        .videoCodec('copy')
        .noAudio()
        .on('stderr', function (err) {
            // console.log(err)
            err = err
                .split(' ')
                .slice(-3, err.length - 1)
                .join(' ')

            if (err == 'muxing overhead: unknown' || err == '404 Not Found') {
                MP4ToMP4(rtsp)
            }
        })
        .on('error', function (err, stdout, stderr) {
            // console.log(err.message)
            if (err.message == 'Output stream closed') {
                MP4Commands[getVariableName(rtsp)].kill()
            }
        })
        .save(`${dir}/${now}.mp4`)
}

function getVariableName(rtsp) {
    return rtsp.split('@').pop().split('/').pop().match(/\d/g).join('')
}

function rebuild(rtsp) {
    const isH264 = h264_rtsps.includes(rtsp) ? true : false
    RTSPCommands[getVariableName(rtsp)].kill()
    MP4Commands[getVariableName(rtsp)].kill()
    if (isH264) {
        RTSPToRTSP(rtsp, 'h264')
    } else {
        RTSPToRTSP(rtsp, 'h265')
    }
    MP4ToMP4(rtsp)
}

app.use(express.static(__dirname))

app.get('/', (req, res) => {
    let videoElements = ''

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
            window[\`video\${url.split('/').pop().match(/\\d/g).join('')}\`].onerror = (e) => {
                console.log('error', e)
            }
            window[\`video\${url.split('/').pop().match(/\\d/g).join('')}\`].onstats = (e) => {
                console.log('onstats', e)
            }
            window[\`video\${url.split('/').pop().match(/\\d/g).join('')}\`].onmedia = (e) => {
                console.log('onmedia', e)
            }
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
    process.stdout.on('data', (data) => {
        data = `${data}`
        const err = data.split(' ').slice(7, 8).join(' ')
        // console.log('err', err)
        // console.log('rtsp', data.split(' ').slice(-1).join(' ').split('/').pop())

        if (err == 'RtspSession.cpp:67') {
            // console.log(data.split(' '))
            // console.log(
            //     'rtsp',
            //     data.split(' ').slice(11, 12).join(' ').replace(/\)+/g, '/').split('/').slice(-2, -1).join(' ')
            // )
            //     const rtsp = `rtsp://admin:!QAZ2wsx87518499@${data.split(' ').slice(-1).join(' ').split('/').pop()}`
            const rtsp = `rtsp://admin:!QAZ2wsx87518499@${data
                .split(' ')
                .slice(11, 12)
                .join(' ')
                .replace(/\)+/g, '/')
                .split('/')
                .slice(-2, -1)
                .join(' ')}`
            rebuild(rtsp)
        }
    })
    // process.stderr.on('data', (data) => {
    //     console.error(`stderr: ${data}`)
    // })
    // process.on('close', (code) => {
    //     console.log('Child close')
    // })

    if (h264_rtsps.length > 0) {
        h264_rtsps.forEach((rtsp) => {
            RTSPToRTSP(rtsp, 'h264')
        })
    }

    if (h265_rtsps.length > 0) {
        h265_rtsps.forEach((rtsp) => {
            RTSPToRTSP(rtsp, 'h265')
        })
    }

    // 定期執行片段備分
    setInterval(
        (function backup() {
            rtsps.forEach((rtsp) => {
                MP4ToMP4(rtsp)
            })
            return backup
        })(),
        segmentInSeconds * 1000
    )

    // 定期清除逾期一個月備份
    setInterval(
        (function clearExpiredBackups() {
            const dir = '/mnt/d/backup/'
            fs.readdir(dir, (err, dates) => {
                if (err) throw err

                dates.forEach((date) => {
                    const currentDate = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
                        .toISOString()
                        .replace(/\:+/g, '-')
                        .slice(0, 10)
                    let dateDiff = parseInt(Math.abs(new Date(currentDate) - new Date(date)) / 1000 / 60 / 60 / 24)

                    if (dateDiff > 30) fs.rmSync(`${dir}/${date}`, { recursive: true, force: true })
                })
            })
            return clearExpiredBackups
        })(),
        1000 * 60 * 60 // 每小時
    )
})

// Terminate server & ffmpeg processes
process.on('SIGINT', (code) => {
    server.close()
    spawn(`killall ffmpeg`, {
        shell: true,
    })
})
