const { rtsps } = require('./config')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg')
const segmentInSeconds = 60 // 每分鐘擷取一次錄影片段
// 預設最大監聽器數
let defaultMaxListeners = require('events').EventEmitter.defaultMaxListeners

function encode(rtsp, ip, dir) {
    require('events').EventEmitter.defaultMaxListeners += 2

    const now = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .replace(/\:+/g, '-')
        .slice(0, -5)
        .split('T')
        .join(' ')
    const command = ffmpeg(rtsp)

    command
        .addInputOption(
            '-analyzeduration', // 碼流分析時間設置，單位為微秒
            0,
            '-rtsp_transport',
            'tcp'
        )
        .addOutputOption('-preset', 'medium', '-movflags', 'faststart', '-t', segmentInSeconds)
        .outputFormat('mp4')
        .videoCodec('h264_nvenc')
        .noAudio()
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
        .save(`${dir}/${now}.mp4`)
}

// 定期執行片段備分
setInterval(
    (function backup() {
        for (let rtsp of rtsps) {
            const ip = rtsp.split('@').pop()
            const today = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000)
                .toISOString()
                .replace(/\:+/g, '-')
                .slice(0, 10)
            let dir = `/home/ubuntu/rtsp-api/backup/${today}`

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir)
            }

            dir = `${dir}/${ip}`

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir)
            }

            encode(rtsp, ip, dir)
        }
        return backup
    })(),
    segmentInSeconds * 1000
)

// 定期清除逾期一個月備份
setInterval(
    (function clearExpiredBackups() {
        const dir = './backup'
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
