const { spawn } = require('child_process')
const { h264_rtsps, h265_rtsps } = require('./config')
const rtsps = h264_rtsps.concat(h265_rtsps)
const https = require('https')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg')
const options = {
    key: fs.readFileSync(`/home/ubuntu/certificates/privkey.pem`, 'utf8'),
    cert: fs.readFileSync(`/home/ubuntu/certificates/fullchain.pem`, 'utf8'),
}
const express = require('express')
const app = express()
const server = https.createServer(options, app)
const isExternalIp = false
const localhost = isExternalIp
    ? require('child_process').execSync(`curl -s http://checkip.amazonaws.com || printf "0.0.0.0"`).toString().trim()
    : require('ip').address()
const port = 443
const segmentInSeconds = 300 // 每 5 分鐘擷取一次錄影片段

const RTSPCommands = {}
const MP4Commands = {}

function RTSPToRTSP(rtsp, type) {
    const output = `rtsp://${localhost}:9554/live/${rtsp.split('@').pop()}`
    const command = getCommand(rtsp)

    RTSPCommands[command] = ffmpeg(rtsp)

    if (type == 'h264') {
        RTSPCommands[command]
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
                // console.log(rtsp.split('@').pop(),'rtsp', err)
                err = err
                    .split(' ')
                    .slice(-3, err.length - 1)
                    .join(' ')

                if (err == 'muxing overhead: unknown' || err == '404 Not Found') {
                    RTSPCommands[command].kill()
                    RTSPToRTSP(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                console.log(rtsp.split('@').pop(), 'rtsp', err.message)
                if (err.message == 'Output stream closed') {
                    RTSPCommands[command].kill()
                }
                err = err.message.split(' ').slice(-3, -2).pop()
                if (err == '404') {
                    RTSPCommands[command].kill()
                    // RTSPToRTSP(rtsp, type)
                }
                // if (err.message == 'ffmpeg was killed with signal SIGKILL') {
                //     RTSPToRTSP(rtsp, type)
                // }
            })
            .on('end', function () {
                delete RTSPCommands[command]
            })
            .run()
    } else if (type == 'h265') {
        RTSPCommands[command]
            .addInputOption(
                '-fflags',
                '+igndts',
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
                // console.log(rtsp.split('@').pop(), 'rtsp', err)
                err = err
                    .split(' ')
                    .slice(-3, err.length - 1)
                    .join(' ')

                if (err == 'muxing overhead: unknown' || err == '404 Not Found') {
                    RTSPCommands[command].kill()
                    RTSPToRTSP(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                console.log(rtsp.split('@').pop(), 'rtsp', err.message)
                if (err.message == 'Output stream closed') {
                    RTSPCommands[command].kill()
                }
                err = err.message.split(' ').slice(-3, -2).pop()
                if (err == '404') {
                    RTSPCommands[command].kill()
                    // RTSPToRTSP(rtsp, type)
                }
                // if (err.message == 'ffmpeg was killed with signal SIGKILL') {
                //     RTSPToRTSP(rtsp, type)
                // }
            })
            .on('end', function () {
                delete RTSPCommands[command]
            })
            .run()
    }
}

function MP4ToMP4(rtsp) {
    const mp4 = `http://${localhost}:9080/live/${rtsp.split('@').pop()}.live.mp4`
    const ip = rtsp.split('@').pop().replace(/\:+/g, '_')
    const today = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .replace(/\:+/g, '-')
        .slice(0, 10)
    const now = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .replace(/\:+/g, '-')
        .slice(0, -5)
        .split('T')
        .join(' ')
    let dir = `/mnt/d/backup`

    for (let path of [today, ip]) {
        dir += `/${path}`
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir)
        }
    }
    const command = getCommand(rtsp)
    MP4Commands[command] = ffmpeg(mp4)
    MP4Commands[command]
        .addOutputOption('-fflags', '+igndts', '-preset', 'medium', '-movflags', 'faststart', '-t', segmentInSeconds)
        .outputFormat('mp4')
        .videoCodec('copy')
        .noAudio()
        .on('stderr', function (err) {
            // console.log(rtsp.split('@').pop(),'mp4', err)
            err = err
                .split(' ')
                .slice(-3, err.length - 1)
                .join(' ')

            if (err == 'muxing overhead: unknown' || err == '404 Not Found') {
                MP4Commands[command].kill()
                MP4ToMP4(rtsp)
            }
        })
        .on('error', function (err, stdout, stderr) {
            console.log(rtsp.split('@').pop(), 'mp4', err.message)
            if (err.message == 'Output stream closed') {
                MP4Commands[command].kill()
            }
            err = err.message.split(' ').slice(-3, -2).pop()
            if (err == '404') {
                MP4Commands[command].kill()
                // MP4ToMP4(rtsp)
            }
            // if (err.message == 'ffmpeg was killed with signal SIGKILL') {
            //     MP4ToMP4(rtsp)
            // }
        })
        .on('end', function () {
            delete MP4Commands[command]
        })
        .save(`${dir}/${now}.mp4`)
}

function getCommand(rtsp) {
    const command = 'command'
    const ip = rtsp.split('@').pop().match(/\d/g).join('')
    const now = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .replace(/\:|\-+/g, '')
        .slice(0, -5)
        .split('T')
        .join('')

    return `${command}_${ip}_${now}`
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
           
            setInterval(()=> player.rebuild(), 1000*60*60) // rebuild player every hour
        } 

        const urls = [${rtsps.map((rtsp) => `'wss://stream.ginibio.com/live/${rtsp.split('@').pop()}.live.flv'`)}]

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

    const mediaServer = spawn(
        `/home/ubuntu/ZLMediaKit/release/linux/Debug/MediaServer -s /home/ubuntu/certificates/ssl.pem`,
        {
            shell: true,
        }
    )

    mediaServer.stdout.on('data', (data) => {
        data = `${data}`
        // console.log(data)
        const err = data.split(' ').slice(7, 8).join(' ')

        if (err == 'RtspSession.cpp:67') {
            // 終止當前的串流服務
            const ip = data
                .split(' ')
                .slice(11, 12)
                .join(' ')
                .replace(/\)+/g, '/')
                .split('/')
                .slice(-2, -1)
                .join(' ')
                .match(/\d/g)
                .join('')

            const rtsp = rtsps.filter((rtsp) => rtsp.split('@').pop().match(/\d/g).join('') == ip).join(' ')

            Object.keys(RTSPCommands).forEach((command) => {
                if (command.split('_').slice(1, 2) == ip) {
                    RTSPCommands[command].kill()
                }
            })

            Object.keys(MP4Commands).forEach((command) => {
                if (command.split('_').slice(1, 2) == ip) {
                    MP4Commands[command].kill()
                }
            })

            if (h264_rtsps.includes(rtsp)) {
                RTSPToRTSP(rtsp, 'h264')
            } else {
                RTSPToRTSP(rtsp, 'h265')
            }

            MP4ToMP4(rtsp)
        }
    })

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

process.on('exit', (code) => {
    console.log('exit')
    spawn(`killall ffmpeg MediaServer`, {
        shell: true,
    })
})
