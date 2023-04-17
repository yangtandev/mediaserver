const { spawn } = require('child_process')
const { h264_rtsps, h265_rtsps } = require('./config')
const rtsps = h264_rtsps.concat(h265_rtsps)
const https = require('https')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg')
const options = {
    key: fs.readFileSync(`/etc/letsencrypt/live/stream.ginibio.com/privkey.pem`, 'utf8'),
    cert: fs.readFileSync(`/etc/letsencrypt/live/stream.ginibio.com/fullchain.pem`, 'utf8'),
}
const express = require('express')
const { log } = require('console')
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

/* 
    將原始 RTSP 串流轉換成 Media Server 可接受格式。
*/
function RTSPToRTSP(rtsp, type) {
    const output = `rtsp://${localhost}:9554/live/${rtsp.split('@').pop()}`
    const command = getCommand(rtsp)

    Object.keys(RTSPCommands).forEach((RTSPCommand) => {
        const oldCommand = RTSPCommand.split('_').slice(1, 2).join('')
        const newCommand = command.split('_').slice(1, 2).join('')
        if (oldCommand == newCommand) {
            RTSPCommands[RTSPCommand].kill()
            delete RTSPCommands[RTSPCommand]
        }
    })

    RTSPCommands[command] = ffmpeg(rtsp)

    if (type == 'h264') {
        RTSPCommands[command]
            .addInputOption(
                '-flags',
                'low_delay',
                // '-fflags',
                // 'nobuffer',
                '-rtsp_transport',
                'tcp',
                '-re',
                '-vsync',
                0,
                '-y'
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
            .videoCodec('copy')
            .noAudio()
            .on('stderr', function (err) {
                // console.log(rtsp.split('@').pop(),'rtsp', err)
                err = err
                    .split(' ')
                    .slice(-3, err.length - 1)
                    .join(' ')

                if (
                    err == 'muxing overhead: unknown'
                    // || err == '404 Not Found'
                ) {
                    RTSPToRTSP(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                console.log(rtsp.split('@').pop(), 'rtsp', err.message)
                // if (err.message == 'Output stream closed') {
                //     RTSPCommands[command].kill()
                // }
                err = err.message.split(' ').slice(-2).join(' ')
                if (err == 'Conversion failed!') {
                    RTSPToRTSP(rtsp, type)
                }
                // err = err.message.split(' ').slice(-3, -2).pop()
                // if (err == '404') {
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
                '-flags',
                'low_delay',
                // '-fflags',
                // 'nobuffer',
                '-rtsp_transport',
                'tcp',
                '-re',
                '-hwaccel',
                'cuda',
                '-hwaccel_output_format',
                'cuda',
                '-c:v',
                'hevc_cuvid',
                '-vsync',
                0,
                '-y'
            )
            .addOutputOption(
                // '-fps_mode',
                // 'passthrough',
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

                if (
                    err == 'muxing overhead: unknown'
                    // || err == '404 Not Found'
                ) {
                    RTSPToRTSP(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                console.log(rtsp.split('@').pop(), 'rtsp', err.message)
                // if (err.message == 'Output stream closed') {
                //     RTSPCommands[command].kill()
                // }
                // err = err.message.split(' ').slice(-3, -2).pop()
                // if (err == '404') {
                //     RTSPToRTSP(rtsp, type)
                // }
            })
            .on('end', function () {
                delete RTSPCommands[command]
            })
            .run()
    }
}

/* 
    截取 Media Server 產生的 MP4 串流，並存於指定位置。
*/
function MP4ToMP4(rtsp, is404 = false) {
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

    if (is404) {
        Object.keys(MP4Commands).forEach((MP4Command) => {
            const oldCommand = MP4Command.split('_').slice(1, 2).join('')
            const newCommand = command.split('_').slice(1, 2).join('')
            if (oldCommand == newCommand) {
                MP4Commands[MP4Command].kill()
                delete MP4Commands[MP4Command]
            }
        })
    }

    MP4Commands[command] = ffmpeg(mp4)

    MP4Commands[command]
        .addOutputOption('-preset', 'medium', '-movflags', 'faststart', '-t', segmentInSeconds)
        .outputFormat('mp4')
        .videoCodec('copy')
        .noAudio()
        .on('stderr', function (err) {
            // console.log(rtsp.split('@').pop(),'mp4', err)
            err = err
                .split(' ')
                .slice(-3, err.length - 1)
                .join(' ')

            if (
                err == 'muxing overhead: unknown'
                // || err == '404 Not Found'
            ) {
                MP4ToMP4(rtsp, true)
            }
        })
        .on('error', function (err, stdout, stderr) {
            console.log(rtsp.split('@').pop(), 'mp4', err.message)
            // if (err.message == 'Output stream closed') {
            //     MP4Commands[command].kill()
            // }
            // err = err.message.split(' ').slice(-3, -2).pop()
            // if (err == '404') {
            //     MP4ToMP4(rtsp)
            // }
        })
        .on('end', function () {
            delete MP4Commands[command]
        })
        .save(`${dir}/${now}.mp4`)
}

/*  
    取得指令變數名。
*/
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

/*  
    啟動 Media Server。
*/
function runMediaServer() {
    const mediaServer = spawn(
        `/home/ubuntu/ZLMediaKit/release/linux/Debug/MediaServer -s /home/ubuntu/certificates/ssl.pem`,
        {
            shell: true,
        }
    )

    mediaServer.stdout.on('data', (data) => {
        data = `${data}`
        const err = data.split(' ').slice(7, 8).join(' ')

        // RTSP 斷訊重連
        if (err == 'RtspSession.cpp:67') {
            console.log('ip', data.split(' '))
            const ip = data
                .split(' ')
                .filter((str) => str.includes('__defaultVhost__'))
                .join(' ')
                .replace(/\)+/g, '/')
                .split('/')
                .slice(-2, -1)
                .join(' ')
                .match(/\d/g)
                .join('')
            const rtsp = rtsps.filter((rtsp) => rtsp.split('@').pop().match(/\d/g).join('') == ip).join(' ')

            if (h264_rtsps.includes(rtsp)) {
                RTSPToRTSP(rtsp, 'h264')
            } else {
                RTSPToRTSP(rtsp, 'h265')
            }

            MP4ToMP4(rtsp, true)
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

    // 每小時自動重啟 Media Server，校正累積延遲。
    setTimeout(() => {
        const killMediaServer = spawn('kill -s 9 `pgrep MediaServer`', {
            shell: true,
        })
        killMediaServer.on('close', (code) => {
            runMediaServer()
        })
    }, 1000 * 60 * 60)
}

/*  
    啟動備份機制。
*/
function runBackup() {
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
            const expireLimitDays = 1
            fs.readdir(dir, (err, dates) => {
                if (err) throw err

                dates.forEach((date) => {
                    const currentDate = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
                        .toISOString()
                        .replace(/\:+/g, '-')
                        .slice(0, 10)
                    let dateDiff = parseInt(Math.abs(new Date(currentDate) - new Date(date)) / 1000 / 60 / 60 / 24)

                    if (dateDiff > expireLimitDays) fs.rmSync(`${dir}/${date}`, { recursive: true, force: true })
                })
            })
            return clearExpiredBackups
        })(),
        1000 * 60 * 60 // 每小時
    )
}

app.use(express.static(__dirname))

app.get('/', (req, res) => {
    let containers = ''

    rtsps.forEach((rtsp, index) => {
        containers += `<div class="flex"><div class="title">${rtsp
            .split('@')
            .pop()}</div><div id="container${index}" class="container"></div></div>`
    })

    res.send(` 
    <style type="text/css" scoped>
        body{
            margin: 0;
            background-color: black;
        }
        body::-webkit-scrollbar {
            display: none;
        }
        .grid {
            display:grid;
            grid-template-columns: auto auto auto auto auto auto;
            height: 100vh;
        }
        .flex{
            display:flex;
            flex-direction:column;
            justify-content: center;    
            align-items: center;
            height:33.3vh;   
        }
        .title{
            display:block;
            font-size: 1.5em;
            font-weight: bold;
            color: white;
            margin: 0.5em 0em 0.5em 0em;
        }
        .container{
        }
    </style>
    <script src="./lib/jessibuca-pro.js"></script>
    <div class="grid">
        ${containers}
    </div>
    <script>  
        function create(url, id) {
            const ip = url.split('/').pop().split('.').slice(0,-2).join('.')
            const $container = document.getElementById('container' + id);
            const player = new JessibucaPro({
                decoder:'/lib/decoder-pro.js',
                container: $container,
                videoBuffer: 0.1, 
                isResize: true,
                hasAudio: false,
                isFlv: true,
                loadingText: "",
                debug: false,
                showBandwidth: false, 
                loadingTimeoutReplayTimes:-1,
                heartTimeoutReplayTimes:-1, 
                autoWasm:true,
                videoBuffer:0,
                videoBufferDelay:0.3,
                useSIMD:true,
                operateBtns: {
                    fullscreen: false,
                    screenshot: false,
                    play: false,
                    audio: false,
                }
            },);

            player.on('pause', function () {
                player.play()   
            });

            player.on("error", function (error) {
                if (error === player.ERROR.playError ) {
                    console.log('playError :',ip, error)
                } else if (error === player.ERROR.fetchError ) {
                    console.log('fetchError :',ip, error)
                }else if (error === player.ERROR.websocketError) {
                    console.log('websocketError:',ip, error)
                }else if (error === player.ERROR.webcodecsH265NotSupport) {
                    console.log('webcodecsH265NotSupport:',ip, error)
                }else if (error === player.ERROR.mediaSourceH265NotSupport) {
                    console.log('mediaSourceH265NotSupport:',ip, error)
                }else if (error === player.ERROR.wasmDecodeError ) {
                    console.log('wasmDecodeError :',ip, error)
                }else{
                    console.log('elseError :',ip, error)
                }
            })

            player && player.play(url)
        }

        const urls = [${rtsps.map((rtsp) => `'wss://stream.ginibio.com/live/${rtsp.split('@').pop()}.live.flv'`)}]

        urls.forEach((url, id)=>{  
            create(url, id) 
        })
        
        // setInterval(()=>console.clear(),1000*60*5) // clear logs every 5 minutes
    </script> 
`)
})

server.listen(port, () => {
    console.log(`https://${localhost}:${port}`)

    runMediaServer()
    runBackup()
})

/* 
    程式中止時，清除相關背景程序。
*/
process.on('exit', (code) => {
    console.log('exit')
    server.close()
    spawn('kill -s 9 `pgrep ffmpeg` && kill -s 9 `pgrep MediaServer`', {
        shell: true,
    })
})

process.on('SIGUSR2', (code) => {
    console.log('SIGUSR2')
    server.close()
    spawn('kill -s 9 `pgrep ffmpeg` && kill -s 9 `pgrep MediaServer`', {
        shell: true,
    })
})

// 使用 CTRL + C 終止程式時，可開啟。
// process.on('SIGINT', (code) => {
//     console.log('SIGINT')
//     server.close()
//     spawn('kill -s 9 `pgrep ffmpeg` && kill -s 9 `pgrep MediaServer`', {
//         shell: true,
//     })
// })
