/* 
    Express.js & Node.js
*/
const { spawn } = require('child_process')
const https = require('https')
const fs = require('fs')
const options = {
    key: fs.readFileSync(`/etc/letsencrypt/live/stream.ginibio.com/privkey.pem`, 'utf8'),
    cert: fs.readFileSync(`/etc/letsencrypt/live/stream.ginibio.com/fullchain.pem`, 'utf8'),
}
const express = require('express')
const cors = require('cors')
const app = express()
const server = https.createServer(options, app)
const port = 445

/* 
    Variables
*/
const config = {}
const rtspCommands = {}
const mp4Commands = {}

/*
    Paths
*/
const pm2Path = `$HOME/.nvm/versions/node/v14.16.1/bin/pm2`
const sslPath = './certificates/ssl.pem'
const mediaServerPath = './ZLMediaKit/release/linux/Debug/MediaServer'
const backupPath = `./ZLMediaKit/release/linux/Debug/www`
const rtspListPath = `./ZLMediaKit/release/linux/Debug/www/rtsp-list/rtsp-list.json`
const ffmpeg = require('fluent-ffmpeg')
ffmpeg.setFfmpegPath(`./nvidia/ffmpeg/ffmpeg`)

/*
    Convert the original RTSP stream to a format acceptable to Media Server.
*/
function RTSPToRTSP(rtsp, type) {
    const ip = rtsp.split('@').pop()
    const id = ip.match(/\d+/g)
    const output = `rtsp://localhost:9554/live/${ip}`

    // Terminate the last rtsp process, if it exists.
    if (rtspCommands.hasOwnProperty(id)) {
        rtspCommands[id].kill('SIGINT')
    }

    rtspCommands[id] = ffmpeg(rtsp)

    if (type == 'h264') {
        rtspCommands[id]
            .addInputOption(
                '-rtsp_transport',
                'tcp',
                '-re',
                '-hwaccel',
                'cuda',
                '-hwaccel_output_format',
                'cuda',
                '-c:v',
                'h264_cuvid'
            )
            .addOutputOption(
                '-fps_mode',
                'passthrough',
                '-rtsp_transport',
                'tcp',
                '-preset',
                'medium',
                '-movflags',
                'faststart',
                '-b:v',
                '2000k',
                '-bufsize',
                '2000k',
                '-maxrate',
                '2500k',
                '-y',
                '-threads',
                0
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
                if (
                    !(
                        err.message.includes('ffmpeg was killed with signal SIGKILL') ||
                        err.message.includes('ffmpeg exited with code 255') ||
                        err.message.includes('ffmpeg exited with code 69') ||
                        err.message.includes('ffmpeg exited with code 1')
                    )
                ) {
                    console.log(ip, 'rtsp', err.message)
                }

                if (
                    err.message.includes('Connection refused') ||
                    err.message.includes('Connection timed out') ||
                    err.message.includes('ffmpeg was killed with signal SIGSEGV') ||
                    err.message.includes('5XX Server Error reply') ||
                    err.message.includes('Immediate exit requested') ||
                    err.message.includes('Network is unreachable') ||
                    err.message.includes('Invalid data found when processing input')
                ) {
                    RTSPToRTSP(rtsp, type)
                }
            })
            .run()
    } else if (type == 'h265') {
        rtspCommands[id]
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
                'faststart',
                '-b:v',
                '2000k',
                '-bufsize',
                '2000k',
                '-maxrate',
                '2500k',
                '-y',
                '-threads',
                0
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
                if (
                    !(
                        err.message.includes('ffmpeg was killed with signal SIGKILL') ||
                        err.message.includes('ffmpeg exited with code 255') ||
                        err.message.includes('ffmpeg exited with code 69') ||
                        err.message.includes('ffmpeg exited with code 1')
                    )
                ) {
                    console.log(ip, 'rtsp', err.message)
                }

                if (
                    err.message.includes('Connection refused') ||
                    err.message.includes('Connection timed out') ||
                    err.message.includes('ffmpeg was killed with signal SIGSEGV') ||
                    err.message.includes('5XX Server Error reply') ||
                    err.message.includes('Immediate exit requested') ||
                    err.message.includes('Network is unreachable') ||
                    err.message.includes('Invalid data found when processing input')
                ) {
                    RTSPToRTSP(rtsp, type)
                }
            })
            .run()
    }
}

/*
    Capture the MP4 stream generated by the Media Server and store it in the specified location.
*/
function RTSPToMP4(rtsp) {
    const { clientName } = config.allRtspConfig.find((rtspConfig) => rtspConfig.rtspList.includes(rtsp))
    const ip = rtsp.split('@').pop()
    const id = ip.match(/\d+/g)
    const input = `rtsp://localhost:9554/live/${ip}`
    const today = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .replace(/\:+/g, '-')
        .slice(0, 10)
    const now = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, -5)
        .split('T')
        .join(' ')
    let output = backupPath

    for (let path of [clientName, 'backup', today, ip]) {
        output += `/${path}`
        if (!fs.existsSync(output)) {
            fs.mkdirSync(output)
        }
    }

    output += `/${now}.mp4`

    // Terminate the last backup process, if it exists.
    if (mp4Commands.hasOwnProperty(id)) {
        mp4Commands[id].kill('SIGINT')
    }

    mp4Commands[id] = ffmpeg(input)

    mp4Commands[id]
        .addInputOption('-rtsp_transport', 'tcp')
        .addOutputOption('-fps_mode', 'passthrough', '-preset', 'medium', '-movflags', 'faststart', '-threads', 0)
        .videoCodec('copy')
        .on('stderr', function (err) {})
        .on('error', function (err, stdout, stderr) {})
        .save(output)
}

/*
    Set rtsp list related variables.
*/
function setRtspList() {
    const source = JSON.parse(fs.readFileSync(rtspListPath, 'utf8'))
    config.h264RtspConfig = source.h264RtspConfig
    config.h265RtspConfig = source.h265RtspConfig
    config.allRtspConfig = config.h264RtspConfig.concat(config.h265RtspConfig)
    config.h264RtspList = config.h264RtspConfig
        .map((rtspConfig) => rtspConfig.rtspList)
        .reduce((prev, curr) => prev.concat(curr))
    config.h265RtspList = config.h265RtspConfig
        .map((rtspConfig) => rtspConfig.rtspList)
        .reduce((prev, curr) => prev.concat(curr))
    config.allRtspList = config.h264RtspList.concat(config.h265RtspList)
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

        // RTSP reconnection mechanism.
        if (data.includes('RtspSession.cpp:64')) {
            data = data.split(' ').find((str) => str.includes('__defaultVhost__') && str.includes('RTSP'))

            if (data) {
                const rtsp = config.allRtspList
                    .filter((rtsp) => rtsp.split('@').pop().match(/\d/g).join('') == data.match(/\d/g).join(''))
                    .join(' ')

                if (config.h264RtspList.includes(rtsp)) {
                    RTSPToRTSP(rtsp, 'h264')
                } else if (config.h265RtspList.includes(rtsp)) {
                    RTSPToRTSP(rtsp, 'h265')
                }
            }
        }
    })

    if (config.h264RtspList.length > 0) {
        config.h264RtspList.forEach((rtsp) => {
            RTSPToRTSP(rtsp, 'h264')
        })
    }

    if (config.h265RtspList.length > 0) {
        config.h265RtspList.forEach((rtsp) => {
            RTSPToRTSP(rtsp, 'h265')
        })
    }
}

/*
    Start the backup mechanism.
*/
function runBackup() {
    config.allRtspList.forEach((rtsp) => {
        RTSPToMP4(rtsp)
    })
}

/*
    Periodically clear backups that are one month overdue.
*/
function clearExpiredBackup() {
    const expireLimitDays = 30
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
}

app.use(cors())
app.use(express.json())
app.use(express.static(__dirname))

app.post('/updateRtspList', cors({ origin: 'https://stream.ginibio.com' }), (req, res) => {
    const { data } = req.body
    try {
        JSON.parse(data)
        fs.writeFile(rtspListPath, data, (err) => {
            if (err) throw err

            setRtspList()
            runMediaServer()
            runBackup()
        })
        res.send('success')
    } catch (err) {
        res.send(err.message)
        return
    }
})

/*
    Run all necessary processes.
*/
server.listen(port, () => {
    console.log(`https://stream.ginibio.com/nvr`)

    setRtspList()
    runMediaServer()
    setInterval(
        (function backup() {
            setTimeout(() => {
                runBackup()
                clearExpiredBackup()
            }, 3000) // Reserve three seconds of delay buffer time.

            return backup
        })(),
        1000 * 60 * 5 // Capture stream fragments every five minutes.
    )
})

/* 
    When the program terminates, clear the related background programs.
*/
process.on('SIGINT', (code) => {
    String('SIGINT')
        .split('')
        .forEach((word) => {
            const slashes = String('|').repeat(30)
            console.log(`${slashes} ${word} ${slashes}`)
        })

    spawn('killall -9 ffmpeg MediaServer', {
        shell: true,
    })
})
