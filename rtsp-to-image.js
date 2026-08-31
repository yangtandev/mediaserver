const FS = require('fs-extra');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const IMAGE_PATH = `./ZLMediaKit/release/linux/Debug/www/image`;
const CONFIG_PATH = `./ZLMediaKit/release/linux/Debug/www/config/config.json`;
const FFMPEG = require('fluent-ffmpeg');
const FFMPEG_PATH = '/usr/bin/ffmpeg';
FFMPEG.setFfmpegPath(FFMPEG_PATH);

function isQsvSupported() {
    try {
        execSync("ffmpeg -decoders | grep 'qsv'", { stdio: 'pipe' });
        console.log('[INFO] QSV hardware acceleration is available.');
        return true;
    } catch (error) {
        console.log('[WARN] QSV hardware acceleration not found. Falling back to software decoding.');
        return false;
    }
}

const IS_QSV_SUPPORTED = isQsvSupported();
const IMAGE_COMMANDS = {};
let CONFIG = {};
const RTSP_TIMEOUT_US = '10000000';
const WATCHDOG_INTERVAL_MS = 10000;
const FRAME_IDLE_TIMEOUT_MS = 45000;
const BASE_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 60000;
const FATAL_FFMPEG_PATTERNS = [
	/Connection timed out/i,
	/Connection refused/i,
	/Server returned 404/i,
	/no such stream/i,
	/End of file/i,
	/Input\/output error/i,
	/Invalid data found/i,
	/Error opening input/i,
	/Could not find codec parameters/i,
];
const RTSP_TIMEOUT_INPUT_OPTIONS = getRtspTimeoutInputOptions();

function getRtspTimeoutInputOptions() {
	try {
		const help = execFileSync(FFMPEG_PATH, ['-hide_banner', '-h', 'demuxer=rtsp'], {
			encoding: 'utf8',
		});
		if (help.includes('-timeout')) return ['-timeout', RTSP_TIMEOUT_US];
		if (help.includes('-stimeout')) return ['-stimeout', RTSP_TIMEOUT_US];
	} catch (error) {
		console.warn('[WARN] Could not detect FFmpeg RTSP timeout option.');
	}
	return [];
}

function safeCamId(value) {
	return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getRtspHost(url) {
	return url.split('@').pop().split('/').shift();
}

function getStreamId(url) {
	return getRtspHost(url).match(/\d+/g).join('');
}

function getRetryDelay(retryCount) {
	const delay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * Math.pow(2, retryCount - 1));
	return delay + Math.floor(Math.random() * 3000);
}

function isFatalFfmpegLine(line) {
	return FATAL_FFMPEG_PATTERNS.some((pattern) => pattern.test(line));
}

function stopImageCommand(streamKey, reason) {
	const state = IMAGE_COMMANDS[streamKey];
	if (!state || state.stopping) return;
	state.stopping = true;
	console.warn(`[WARN] Restarting image ffmpeg for ${streamKey}: ${reason}`);
	state.command.kill('SIGTERM');
	setTimeout(() => {
		if (IMAGE_COMMANDS[streamKey] === state) state.command.kill('SIGKILL');
	}, 5000);
}

function RTSPToImage(rtsp, type, clientName, useHwAccel = false, retryCount = 0) {
	const id = getStreamId(rtsp);
	const streamKey = safeCamId(`${type}_${clientName}_${id}`);
	const input = `rtsp://localhost:9554/live/${streamKey}`;
	const output = `${IMAGE_PATH}/${id}.jpg`;

	console.warn(`[PERFORMANCE_WARNING] Stream ${id} is configured for high-frequency JPG overwrite. This will cause high I/O and CPU load and is not recommended for production use.`);

	if (IMAGE_COMMANDS.hasOwnProperty(streamKey)) {
		console.log(`[INFO] Conversion for ${streamKey} is already running.`);
		return;
	}

	if (!FS.existsSync(IMAGE_PATH)) {
		FS.mkdirSync(IMAGE_PATH, { recursive: true });
	}

	const command = FFMPEG(input)
			.addInputOption(
				'-rtsp_transport',
				'tcp',
				...RTSP_TIMEOUT_INPUT_OPTIONS,
				'-vsync',
				'passthrough',
				'-rtbufsize',
			'20M',
			'-y',
			'-threads',
			1
		)
                .addOutputOption('-vf', 'fps=15') // Set the frame rate
                .addOutputOption('-update', '1') // Overwrite the same file
		.addOutputOption('-atomic_writing', '1')
		.output(output)
		.on('start', function (cmd) {
			console.log(`[INFO] Started ffmpeg for ${streamKey}: ${cmd}`);
		})
		.on('end', function () {
			console.log(
				`[INFO] FFMPEG process for ${streamKey} finished successfully.`
			);
			const state = IMAGE_COMMANDS[streamKey];
			if (state && state.watchdog) clearInterval(state.watchdog);
			delete IMAGE_COMMANDS[streamKey];

			const nextRetryCount = (state ? state.retryCount : retryCount) + 1;
			const delay = getRetryDelay(nextRetryCount);
			setTimeout(() => RTSPToImage(rtsp, type, clientName, useHwAccel, nextRetryCount), delay);
		})
		.on('error', function (err, stdout, stderr) {
			console.error(
				`[ERROR] FFMPEG process for ${streamKey} failed:`,
				err.message
			);
			const state = IMAGE_COMMANDS[streamKey];
			if (state && state.watchdog) clearInterval(state.watchdog);
			delete IMAGE_COMMANDS[streamKey];

			let retryWithHwAccel = useHwAccel;
			const ffmpegError = `${err.message}\n${stderr || ''}`;
			if (useHwAccel && (ffmpegError.includes('qsv') || ffmpegError.includes('Hardware') || ffmpegError.includes('No device'))) {
                console.log(`[INFO] RTSP-to-Image HW acceleration failed for ${streamKey}. Retrying with software.`);
                retryWithHwAccel = false;
            }

			const nextRetryCount = (state ? state.retryCount : retryCount) + 1;
			const delay = getRetryDelay(nextRetryCount);
			setTimeout(() => {
				console.log(`[INFO] Retrying conversion for ${streamKey} in ${delay}ms...`);
				RTSPToImage(rtsp, type, clientName, retryWithHwAccel, nextRetryCount);
			}, delay);
		})
		.on('stderr', function (line) {
			const state = IMAGE_COMMANDS[streamKey];
			if (!state) return;
			if (isFatalFfmpegLine(line)) {
				stopImageCommand(streamKey, line);
			}
		});

	if (useHwAccel) {
		command.addInputOption('-hwaccel', 'qsv');
	}

	const state = {
		command,
		lastFrameAt: Date.now(),
		lastOutputMtimeMs: 0,
		retryCount,
		stopping: false,
	};
	state.watchdog = setInterval(() => {
		try {
			if (FS.existsSync(output)) {
				const mtimeMs = FS.statSync(output).mtimeMs;
				if (mtimeMs > state.lastOutputMtimeMs) {
					state.lastOutputMtimeMs = mtimeMs;
					state.lastFrameAt = Date.now();
					state.retryCount = 0;
				}
			}
		} catch (error) {
			console.warn(`[WARN] Could not stat output image for ${streamKey}: ${error.message}`);
		}
		if (Date.now() - state.lastFrameAt > FRAME_IDLE_TIMEOUT_MS) {
			stopImageCommand(streamKey, `no frame for ${FRAME_IDLE_TIMEOUT_MS}ms`);
		}
	}, WATCHDOG_INTERVAL_MS);

	IMAGE_COMMANDS[streamKey] = state;
	command.run();
}

function clearExpiredBackup() {
        const image_path =
                './ZLMediaKit/release/linux/Debug/www/image';
        const thirty_minutes = 30 * 60 * 1000;

        FS.readdir(image_path, (err, files) => {
                if (err) {
                        console.error('Failed to read the dirctory:', err);
                        return;
                }

                const now = Date.now(); 

                files.forEach((file) => {
                        const file_path = path.join(image_path, file);

                        FS.stat(file_path, (err, stats) => {
                                if (err) {
                                        console.error(`Failed to get file stats: ${file}`, err);
                                        return;
                                }

                                const file_modified_time = stats.mtime.getTime();
                                const diff_time = now - file_modified_time;

                                if (diff_time > thirty_minutes) {
                                        FS.unlink(file_path, (err) => {
                                                if (err) {
                                                        console.error(
                                                                `Failed to delete file: ${file}`,
                                                                err
                                                        );
                                                } else {
                                                        console.log(`Deleted expired file: ${file}`);
                                                }
                                        });
                                }
                        });
                });
        });
}

function setRtspList() {
	const source = JSON.parse(FS.readFileSync(CONFIG_PATH, 'utf8'));
	const typeList = ['rtmp', 'h264Rtsp', 'hevcRtsp'];
	CONFIG = JSON.parse(JSON.stringify(source));
	CONFIG[`clientList`] = [];

	typeList.forEach((type) => {
		CONFIG[`clientList`] = CONFIG[`clientList`].concat(
			CONFIG[`${type}ClientList`]
		);

		if (CONFIG[`${type}ClientList`].length > 0) {
			CONFIG[`${type}List`] = CONFIG[`${type}ClientList`]
				.map((client) => {
					if (client[`rtspList`]) return client[`rtspList`];
					if (client[`rtmpList`]) return client[`rtmpList`];
				})
				.reduce((prev, curr) => prev.concat(curr));
		} else {
			CONFIG[`${type}ClientList`] = [];
			CONFIG[`${type}List`] = [];
		}
	});

	CONFIG.allRtspList = []
		.concat(CONFIG.h264RtspList)
		.concat(CONFIG.hevcRtspList);
}

setRtspList();

if (CONFIG.h264RtspClientList && CONFIG.h264RtspClientList.length > 0) {
	for (const client of CONFIG.h264RtspClientList) {
		for (const rtsp of client.rtspList || []) {
			RTSPToImage(rtsp, 'h264', client.clientName, IS_QSV_SUPPORTED);
		}
	}
}

if (CONFIG.hevcRtspClientList && CONFIG.hevcRtspClientList.length > 0) {
	for (const client of CONFIG.hevcRtspClientList) {
		for (const rtsp of client.rtspList || []) {
			RTSPToImage(rtsp, 'hevc', client.clientName, IS_QSV_SUPPORTED);
		}
	}
}

// Keep the last screenshot while cameras may be powered off.
// setInterval(clearExpiredBackup, 300000);
// clearExpiredBackup();

function cleanupAndExit() {
	console.log(
		'Received exit signal. Gracefully cleaning up all running ffmpeg processes...'
	);
	const running_processes = Object.keys(IMAGE_COMMANDS);
	if (running_processes.length === 0) {
		console.log('No ffmpeg processes to kill.');
		return process.exit(0);
	}

	running_processes.forEach((streamKey) => {
		const state = IMAGE_COMMANDS[streamKey];
		if (state) {
			console.log(`Stopping ffmpeg process for ${streamKey}...`);
			if (state.watchdog) clearInterval(state.watchdog);
			state.command.removeAllListeners();
			state.command.kill('SIGTERM');
			delete IMAGE_COMMANDS[streamKey];
		}
	});

	setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);
