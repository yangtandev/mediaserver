/* 
    Express.js & Node.js
*/
const { spawn } = require('child_process')
const https = require('https')
const fs = require('fs')
const host = {
    externalIp: require('child_process')
        .execSync(`curl -s http://checkip.amazonaws.com || printf "0.0.0.0"`)
        .toString()
        .trim(),
    internalIp: require('ip').address(),
}
const options = {
    key: fs.readFileSync(`/etc/letsencrypt/live/stream.ginibio.com/privkey.pem`, 'utf8'),
    cert: fs.readFileSync(`/etc/letsencrypt/live/stream.ginibio.com/fullchain.pem`, 'utf8'),
}
const express = require('express')
const app = express()
const server = https.createServer(options, app)
const port = 445

/* 
    Params
*/
const { h264_rtsps, h265_rtsps } = require('./config')
const rtsps = h264_rtsps.concat(h265_rtsps)
const segmentInSeconds = 300 // Capture stream fragments every 5 minutes
const RTSPCommands = {}
const MP4Commands = {}

/* 
    Paths
*/
const home = require('path').join(__dirname, '..')
const pm2Path = `${home}/.nvm/versions/node/v14.16.1/bin/pm2`
const mediaServerPath = './ZLMediaKit/release/linux/Debug/MediaServer'
const sslPath = './certificates/ssl.pem'
const backupPath = `./buckup`
const ffmpeg = require('fluent-ffmpeg')
ffmpeg.setFfmpegPath(`./nvidia/ffmpeg/ffmpeg`)

/*  
    Get command variable name.
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
    Convert the original RTSP stream to a format acceptable to Media Server.
*/
function RTSPToRTSP(rtsp, type) {
    const output = `rtsp://${host.internalIp}:9554/live/${rtsp.split('@').pop()}`
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
            .addInputOption('-flags', 'low_delay', '-rtsp_transport', 'tcp', '-re', '-y')
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
                if (err.includes('muxing overhead: unknown')) {
                    RTSPToRTSP(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                if (!err.message.includes('ffmpeg was killed with signal SIGKILL')) {
                    console.log(rtsp.split('@').pop(), 'rtsp', err.message)

                    if (
                        // err.message.includes('Conversion failed!') ||
                        // err.message.includes('Connection refused') ||
                        // err.message.includes('Connection timed out') ||
                        err.message.includes('Exiting normally, received signal 2') ||
                        err.message.includes('Network is unreachable') ||
                        err.message.includes('Invalid data found when processing input')
                    ) {
                        RTSPToRTSP(rtsp, type)
                    }
                }
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
                '-rtsp_transport',
                'tcp',
                '-re',
                '-hwaccel',
                'cuda',
                '-hwaccel_output_format',
                'cuda',
                '-c:v',
                'hevc_cuvid',
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
            .videoCodec('h264_nvenc')
            .noAudio()
            .on('stderr', function (err) {
                if (err.includes('muxing overhead: unknown')) {
                    RTSPToRTSP(rtsp, type)
                }
            })
            .on('error', function (err, stdout, stderr) {
                if (!err.message.includes('ffmpeg was killed with signal SIGKILL')) {
                    console.log(rtsp.split('@').pop(), 'rtsp', err.message)

                    if (
                        // err.message.includes('Conversion failed!') ||
                        // err.message.includes('Connection refused') ||
                        // err.message.includes('Connection timed out') ||
                        err.message.includes('Exiting normally, received signal 2') ||
                        err.message.includes('Network is unreachable') ||
                        err.message.includes('Invalid data found when processing input')
                    ) {
                        RTSPToRTSP(rtsp, type)
                    }
                }
            })
            .on('end', function () {
                delete RTSPCommands[command]
            })
            .run()
    }
}

/* 
    Capture the MP4 stream generated by the Media Server and store it in the specified location.
*/
function MP4ToMP4(rtsp, is404 = false) {
    const mp4 = `http://${host.internalIp}:9080/live/${rtsp.split('@').pop()}.live.mp4`
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
    let dir = backupPath

    for (let path of ['', today, ip]) {
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
            if (err.includes('muxing overhead: unknown')) {
                MP4ToMP4(rtsp, true)
            }
        })
        .on('error', function (err, stdout, stderr) {})
        .on('end', function () {
            delete MP4Commands[command]
        })
        .save(`${dir}/${now}.mp4`)
}

/*  
    Run media server。
*/
function runMediaServer() {
    const mediaServer = spawn(`${mediaServerPath} -s ${sslPath}`, {
        shell: true,
    })

    mediaServer.stdout.on('data', (data) => {
        data = `${data}`

        // RTSP reconnection mechanism
        if (data.includes('RtspSession.cpp:67')) {
            data = data.split(' ').find((str) => str.includes('__defaultVhost.internalIp__') && str.includes('RTSP'))

            if (data) {
                const ip = data.match(/\d/g).join('')
                const rtsp = rtsps.filter((rtsp) => rtsp.split('@').pop().match(/\d/g).join('') == ip).join(' ')

                if (h264_rtsps.includes(rtsp)) {
                    RTSPToRTSP(rtsp, 'h264')
                } else if (h265_rtsps.includes(rtsp)) {
                    RTSPToRTSP(rtsp, 'h265')
                }

                MP4ToMP4(rtsp, true)
            }
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
}

/*  
    Start the backup mechanism.
*/
function runBackup() {
    // Periodically back up stream fragments.
    setInterval(
        (function backup() {
            rtsps.forEach((rtsp) => {
                MP4ToMP4(rtsp)
            })
            return backup
        })(),
        segmentInSeconds * 1000
    )

    // Periodically clear backups that are one month overdue.
    setInterval(
        function clearExpiredBackups() {
            const expireLimitDays = 2
            fs.readdir(backupPath, (err, dates) => {
                if (err) throw err

                dates.forEach((date) => {
                    const currentDate = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
                        .toISOString()
                        .replace(/\:+/g, '-')
                        .slice(0, 10)
                    let dateDiff = parseInt(Math.abs(new Date(currentDate) - new Date(date)) / 1000 / 60 / 60 / 24)

                    if (dateDiff > expireLimitDays) fs.rmSync(`${backupPath}/${date}`, { recursive: true, force: true })
                })
            })
        },
        1000 * 60 * 30 // half hour.
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
            grid-template-columns: auto auto auto;
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
    <script src="../lib/jessibuca-pro.js"></script>
    <div class="grid">
        ${containers}
    </div>
    <script>  
        function create(url, id) {
            const $container = document.getElementById('container' + id);
            const player = new JessibucaPro({
                decoder:'/lib/decoder-pro.js',
                container: $container,
                videoBuffer: 0, 
                videoBufferDelay:0.3,
                isResize: true,
                isFlv: true,
                hasAudio: false,
                loadingText: "",
                debug: false,
                showBandwidth: false, 
                loadingTimeoutReplayTimes:10,
                heartTimeoutReplayTimes:10, 
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

            player && player.play(url)
        }

        const urls = [${rtsps.map((rtsp) => `'wss://stream.ginibio.com/live/${rtsp.split('@').pop()}.live.flv'`)}]

        urls.forEach((url, id)=>{  
            create(url, id) 
        })
        
        setInterval(()=>console.clear(),1000*60*30) // clear logs every half hour.
    </script> 
`)
})

server.listen(port, () => {
    console.log(`https://${host.externalIp}:${port}`)

    runMediaServer()
    runBackup()

    // Automatically restart the NVR every hour, correcting the accumulated delay.
    setInterval(function reloadNVR() {
        spawn(`${pm2Path} reload nvr`, {
            shell: true,
        })
    }, 1000 * 60 * 60)
})

/* 
    When the program terminates, clear the related background programs.
*/
// process.on('exit', (code) => {
//     console.log('exit')
//     server.close()
//     spawn('kill -s 9 `pgrep ffmpeg` `pgrep MediaServer`', {
//         shell: true,
//     })
// })

// process.on('SIGUSR2', (code) => {
//     console.log('SIGUSR2')
//     server.close()
//     spawn('kill -s 9 `pgrep ffmpeg` `pgrep MediaServer`', {
//         shell: true,
//     })
// })

process.on('SIGINT', (code) => {
    console.log('%cSIGINT!', 'color: green')

    spawn('kill -s 9 `pgrep ffmpeg` `pgrep MediaServer`', {
        shell: true,
    })
})
