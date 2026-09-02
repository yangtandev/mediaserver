const HTTP = require('http');
const FS = require('fs');
const PATH = require('path');
const SPAWN = require('child_process').spawn;
const EXPRESS = require('express');
const CORS = require('cors');
const APP = EXPRESS();
const SERVER = HTTP.createServer(APP);
const PORT = 3000;
const PM2_PATH = process.env.NVM_BIN + '/pm2';
const BACKUP_PATH = `./ZLMediaKit/release/linux/Debug/www`;
const CONFIG_PATH = `./ZLMediaKit/release/linux/Debug/www/config/config.json`;
const MEDIA_SERVER_PATH = './ZLMediaKit/release/linux/Debug/MediaServer';
const CCTV_DATA_PATH = PATH.join(BACKUP_PATH, 'cctv', 'data');
const FFMPEG = require('fluent-ffmpeg');
const FFMPEG_PATH = '/usr/bin/ffmpeg';
FFMPEG.setFfmpegPath(FFMPEG_PATH);
const { execFileSync, execSync } = require('child_process');

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
let RTSP_COMMANDS = {};
let RTSP_RETRY_COUNTS = {};
let MP4_COMMANDS = {};
let CCTV_RECORD_COMMANDS = {};
let CCTV_SNAP_COMMANDS = {};
let CONFIG = {};
let CONVERT_LIVE_STREAM_TO_MP4 = false;
const RTSP_TIMEOUT_US = '10000000';
const CCTV_SNAPSHOT_TIMEOUT_MS = 5000;
const BASE_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 60000;
const RTSP_TIMEOUT_INPUT_OPTIONS = getRtspTimeoutInputOptions();
const CCTV_CLIENT_GROUPS = [
	{ key: 'rtmpClientList', type: 'rtmp' },
	{ key: 'h264RtspClientList', type: 'h264' },
	{ key: 'hevcRtspClientList', type: 'hevc' },
];

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

function ensureDir(dir) {
	if (!FS.existsSync(dir)) {
		FS.mkdirSync(dir, { recursive: true });
	}
}

function fileInfo(path, publicPath) {
	if (!FS.existsSync(path)) return null;
	const stat = FS.statSync(path);
	if (!stat.isFile() || stat.size === 0) return null;

	return {
		path: `${publicPath}?t=${stat.mtimeMs}`,
		size: stat.size,
		updatedAt: stat.mtime.toISOString(),
	};
}

function checkSnapshotQuality(imagePath) {
	const minBytes = 8192;
	const width = 64;
	const height = 36;
	const pixels = width * height;
	const stat = FS.statSync(imagePath);
	if (!stat.isFile() || stat.size < minBytes) {
		return { ok: false, reason: `too small (${stat.size} bytes)` };
	}

	let raw;
	try {
		raw = execFileSync(
			'/usr/bin/ffmpeg',
			[
				'-v',
				'error',
				'-i',
				imagePath,
				'-vf',
				`scale=${width}:${height}:flags=area`,
				'-frames:v',
				'1',
				'-f',
				'rawvideo',
				'-pix_fmt',
				'rgb24',
				'-',
			],
			{ maxBuffer: pixels * 3 + 1024 }
		);
	} catch (err) {
		if (err.stdout && err.stdout.length >= pixels * 3) {
			raw = err.stdout;
		} else {
			return { ok: false, reason: 'decode failed' };
		}
	}

	if (raw.length < pixels * 3) return { ok: false, reason: 'incomplete pixels' };

	const gray = new Float32Array(pixels);
	const artifactMask = new Uint8Array(pixels);
	const noisyArtifactRows = new Uint16Array(height);
	let sum = 0;
	let sumSq = 0;
	let chromaSum = 0;
	let greenPixels = 0;
	let artifactPixels = 0;

	for (let i = 0, p = 0; i < raw.length; i += 3, p += 1) {
		const r = raw[i];
		const g = raw[i + 1];
		const b = raw[i + 2];
		const y = (r + g + b) / 3;
		const maxChannel = Math.max(r, g, b);
		const minChannel = Math.min(r, g, b);
		const spread = maxChannel - minChannel;
		gray[p] = y;
		sum += y;
		sumSq += y * y;
		chromaSum += Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b);
		if (g > 90 && g > r * 1.35 && g > b * 1.35) greenPixels += 1;
		if (maxChannel > 115 && spread > 80) {
			artifactPixels += 1;
			artifactMask[p] = 1;
		}
	}

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const p = y * width + x;
			if (!artifactMask[p]) continue;
			const i = p * 3;
			let noisy = false;
			if (x > 0) {
				const left = i - 3;
				noisy = noisy || Math.max(
					Math.abs(raw[i] - raw[left]),
					Math.abs(raw[i + 1] - raw[left + 1]),
					Math.abs(raw[i + 2] - raw[left + 2])
				) > 70;
			}
			if (y > 0) {
				const up = i - width * 3;
				noisy = noisy || Math.max(
					Math.abs(raw[i] - raw[up]),
					Math.abs(raw[i + 1] - raw[up + 1]),
					Math.abs(raw[i + 2] - raw[up + 2])
				) > 70;
			}
			if (noisy) noisyArtifactRows[y] += 1;
		}
	}

	let edgeSum = 0;
	let edgeCount = 0;
	const regionStats = (fromY, toY) => {
		let edge = 0;
		let count = 0;
		for (let y = fromY; y < toY; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const index = y * width + x;
				if (x > 0) {
					edge += Math.abs(gray[index] - gray[index - 1]);
					count += 1;
				}
				if (y > fromY) {
					edge += Math.abs(gray[index] - gray[index - width]);
					count += 1;
				}
			}
		}
		return { edge: count ? edge / count : 0 };
	};
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;
			if (x > 0) {
				edgeSum += Math.abs(gray[index] - gray[index - 1]);
				edgeCount += 1;
			}
			if (y > 0) {
				edgeSum += Math.abs(gray[index] - gray[index - width]);
				edgeCount += 1;
			}
		}
	}

	const mean = sum / pixels;
	const variance = Math.max(0, sumSq / pixels - mean * mean);
	const stddev = Math.sqrt(variance);
	const edge = edgeSum / edgeCount;
	const chroma = chromaSum / pixels;
	const isMiddleBrightness = mean > 15 && mean < 240;
	const middle = regionStats(Math.floor(height * 0.25), Math.floor(height * 0.75));
	const bottom = regionStats(Math.floor(height * 0.8), height);
	const greenRatio = greenPixels / pixels;
	const artifactRatio = artifactPixels / pixels;
	const badArtifactRows = Array.from(noisyArtifactRows).filter((count) => count / width > 0.35).length;
	const artifactRowRatio = badArtifactRows / height;

	if (greenRatio > 0.70) {
		return { ok: false, reason: `green screen (green ${greenRatio.toFixed(3)})` };
	}
	if (artifactRatio > 0.12 && artifactRowRatio > 0.08) {
		return { ok: false, reason: `decode artifacts (artifact ${artifactRatio.toFixed(3)}, rows ${artifactRowRatio.toFixed(3)})` };
	}
	if (isMiddleBrightness && stddev < 7 && edge < 3 && chroma < 12) {
		return { ok: false, reason: `flat frame (stddev ${stddev.toFixed(1)}, edge ${edge.toFixed(1)})` };
	}
	if (middle.edge > 8 && bottom.edge < 4 && bottom.edge < middle.edge * 0.35) {
		return { ok: false, reason: `bad bottom band (bottom edge ${bottom.edge.toFixed(1)}, middle edge ${middle.edge.toFixed(1)})` };
	}

	return { ok: true };
}

function getRtspHost(url) {
	return url.split('@').pop().split('/').shift();
}

function getStreamId(url, type) {
	if (type === 'rtmp') {
		return url.split('/').pop();
	}

	return getRtspHost(url).match(/\d+/g).join('');
}

function buildCctvCameras() {
	const cameras = [];

	CCTV_CLIENT_GROUPS.forEach(({ key, type }) => {
		(CONFIG[key] || []).forEach((client, clientIndex) => {
			const list = client.rtspList || client.rtmpList || [];
			list.forEach((url, index) => {
				const streamId = getStreamId(url, type);
				const ip = type === 'rtmp' ? streamId : getRtspHost(url);
				const id = safeCamId(`${type}_${client.clientName}_${streamId}`);
				const dir = PATH.join(CCTV_DATA_PATH, id);
				const replayPath = PATH.join(dir, 'replay.mp4');
				const coverPath = PATH.join(dir, 'cover.jpg');
				const zlmRtspUrl = `rtsp://127.0.0.1:9554/live/${id}`;
				const metaPath = PATH.join(dir, 'replay.json');
				let replayMeta = null;

				if (FS.existsSync(metaPath)) {
					try {
						replayMeta = JSON.parse(FS.readFileSync(metaPath, 'utf8'));
					} catch (err) {
						console.warn(`[WARN] Bad CCTV replay metadata: ${metaPath}`);
					}
				}

				cameras.push({
					id,
					name: client.cameraName || client.camName || `${client.clientName} ${index + 1}`,
					clientName: client.clientName,
					ip,
					type,
					streamId,
					livePath: `live/${id}.live.flv`,
					cover: fileInfo(coverPath, `cctv/data/${id}/cover.jpg`),
					replay: fileInfo(replayPath, `cctv/data/${id}/replay.mp4`),
					replayMeta,
					recording: Boolean(CCTV_RECORD_COMMANDS[id]),
					sourceUrl: url,
					recordUrl: zlmRtspUrl,
					snapshotUrl: zlmRtspUrl,
				});
			});
		});
	});

	return cameras;
}

function publicCamera(camera) {
	const { sourceUrl, recordUrl, snapshotUrl, ...safeCamera } = camera;
	return safeCamera;
}

function findCctvCamera(id) {
	return buildCctvCameras().find((camera) => camera.id === id);
}

function findCctvConfigEntry(config, id) {
	for (const { key, type } of CCTV_CLIENT_GROUPS) {
		for (const client of config[key] || []) {
			for (const url of client.rtspList || client.rtmpList || []) {
				const streamId = getStreamId(url, type);
				const entryId = safeCamId(`${type}_${client.clientName}_${streamId}`);
				if (entryId === id) return { client };
			}
		}
	}

	return null;
}

function stopTrackedCommand(bucket, id, signal = 'SIGTERM') {
	const item = bucket[id];
	if (!item) return false;
	item.stopping = true;
	item.command.kill(signal);
	return true;
}

function getRetryDelay(retryCount) {
	const delay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * Math.pow(2, retryCount - 1));
	return delay + Math.floor(Math.random() * 3000);
}

/*
    Run ZLMediaKit MediaServer.
*/
function runMediaServer() {
    const command = `${MEDIA_SERVER_PATH}`;
    const mediaServer = SPAWN(command, {
        shell: true,
    });

    mediaServer.stdout.on('data', (rawData) => {
        // Only print out the output, do not handle any logic
        console.log(`[MediaServer]: ${rawData}`);
    });

    mediaServer.stderr.on('data', (data) => {
        console.error(`[MediaServer ERROR]: ${data}`);
    });

    mediaServer.on('close', (code) => {
        console.log(`[MediaServer] child process exited with code ${code}`);
    });
}

/*
    Convert the original RTSP stream to a format acceptable to Media Server.
*/
function RTSPToRTSP(rtsp, type, streamKey) {
	const ip = rtsp.split('@').pop().split('/').shift();
	const id = streamKey || ip.match(/\d+/g).join('');
	const output = `rtsp://localhost:9554/live/${id}`;

	const scheduleRetry = () => {
		RTSP_RETRY_COUNTS[id] = (RTSP_RETRY_COUNTS[id] || 0) + 1;
		const delay = getRetryDelay(RTSP_RETRY_COUNTS[id]);
		setTimeout(() => {
			console.log(`[INFO] Retrying RTSP-to-RTSP conversion for ${id} after ${delay}ms...`);
			RTSPToRTSP(rtsp, type, streamKey);
		}, delay);
	};

	if (RTSP_COMMANDS.hasOwnProperty(id)) {
		console.log(
			`[INFO] RTSP-to-RTSP conversion for ${id} is already running.`
		);
		return;
	}

	const command = FFMPEG(rtsp)
		.addInputOption('-rtsp_transport', 'tcp', ...RTSP_TIMEOUT_INPUT_OPTIONS, '-re', '-threads', 1)
		.addOutputOption(
			'-map',
			'0:v:0',
			'-dn',
			'-rtsp_transport',
			'tcp',
			'-f',
			'rtsp'
		)
		.output(output);

	if (type === 'hevc') {
		command
			.videoCodec('libx264')
			.addOutputOption('-preset', 'fast', '-tune', 'zerolatency');
	} else if (type === 'h264') {
		command.videoCodec('copy');
	}

	command
		.noAudio()
		.on('start', function (cmd) {
			console.log(`[INFO] Started RTSP-to-RTSP for ${id}: ${cmd}`);
		})
		.on('end', function () {
			console.log(
				`[INFO] RTSP-to-RTSP process for ${id} finished successfully.`
			);
			delete RTSP_COMMANDS[id];

			scheduleRetry();
		})
		.on('error', function (err, stdout, stderr) {
			console.error(
				`[ERROR] RTSP-to-RTSP process for ${id} failed:`,
				err.message
			);
			delete RTSP_COMMANDS[id];
			
			scheduleRetry();
		});

	RTSP_COMMANDS[id] = command;
	command.run();
}

/*
    Capture the MP4 stream generated by the Media Server and store it in the specified location.
*/
function RTSPToMP4(rtsp, type) {
	const ip = rtsp.includes('@')
		? rtsp.split('@').pop().split('/').shift()
		: rtsp.split('/').pop();

	const id = ip.includes(':') ? ip.match(/\d+/g).join('') : ip;
	const clientInfo = CONFIG.clientList.find((client) => {
		if (client.rtspList) {
			return client.rtspList.includes(rtsp);
		}
	});

	if (!clientInfo) {
		console.error(`[ERROR] Could not find client info for RTSP: ${rtsp}`);
		return;
	}
	const { clientName } = clientInfo;

	const input = `rtsp://localhost:9554/live/${id}`;
	const now = new Date(
		new Date().getTime() - new Date().getTimezoneOffset() * 60000 + 13000
	);
	const today = now.toISOString().replace(/\:+/g, '-').slice(0, 10);
	const fileName = now.toISOString().slice(0, -5).split('T').join(' ');
	let output_dir = BACKUP_PATH;

	for (let path of [clientName, 'backup', today, ip]) {
		output_dir += `/${path}`;
		if (!FS.existsSync(output_dir)) {
			FS.mkdirSync(output_dir, { recursive: true });
		}
	}

	const output_path = `${output_dir}/${fileName}.mp4`;

	if (MP4_COMMANDS.hasOwnProperty(id)) {
		console.log(
			`[INFO] RTSP-to-MP4 conversion for ${id} is already running.`
		);
		return;
	}

	let command = FFMPEG(input)
		.addInputOption(
			'-rtsp_transport',
			'tcp',
			'-use_wallclock_as_timestamps',
			1,
			'-ss',
			0,
			'-to',
			300, // 5 minutes
			'-threads',
			2
		)
		.addOutputOption(
			'-fps_mode',
			'passthrough',
			'-preset',
			'medium',
			'-movflags',
			'faststart',
			'-avoid_negative_ts',
			'make_zero',
		)
		.noAudio()
		.on('start', function (cmd) {
			console.log(`[INFO] Started RTSP-to-MP4 for ${id}: ${cmd}`);
		})
		.on('end', function () {
			console.log(`[INFO] RTSP-to-MP4 clip for ${id} finished.`);
			delete MP4_COMMANDS[id]; // Clean up before restarting

			// Check for zero-byte file
			FS.stat(output_path, (error, stats) => {
				if (error) {
					console.error(
						`[ERROR] Could not stat output file ${output_path}:`,
						error
					);
				} else if (stats.isFile() && stats.size === 0) {
					console.log(
						`[INFO] Removing zero-byte file: ${output_path}`
					);
					FS.unlink(output_path, (err) => {
						if (err)
							console.error(
								`[ERROR] Failed to delete zero-byte file:`,
								err
							);
					});
				}
			});

			// Loop to record the next clip
			RTSPToMP4(rtsp, type);
		})
		.on('error', function (err, stdout, stderr) {
			console.error(
				`[ERROR] RTSP-to-MP4 process for ${id} failed:`,
				err.message
			);
			delete MP4_COMMANDS[id];
			
			let retryWithHwAccel = IS_QSV_SUPPORTED;
			if (IS_QSV_SUPPORTED && (err.message.includes('qsv') || err.message.includes('Hardware') || err.message.includes('No such device'))) {
                console.log(`[INFO] RTSP-to-MP4 HW acceleration failed for ${id}. Retrying with software.`);
                retryWithHwAccel = false;
            }

			setTimeout(() => {
				console.log(
					`[INFO] Retrying RTSP-to-MP4 conversion for ${rtsp}...`
				);
				RTSPToMP4(rtsp, type);
			}, 5000);
		});

	if (IS_QSV_SUPPORTED) {
		command.addInputOption('-hwaccel', 'qsv');
		if (type === 'hevc') {
			command.addInputOption('-c:v', 'hevc_qsv');
		} else if (type === 'h264') {
			command.addInputOption('-c:v', 'h264_qsv');
		}
		command.videoCodec('h264_qsv'); // QSV encoding
	} else {
		command.videoCodec('libx264'); // Software encoding
	}
	
	command.save(output_path);

	MP4_COMMANDS[id] = command;
}

/*
    Set rtsp list related variables.
*/
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

/*
    Periodically clear backups that are one month overdue.
*/
function clearExpiredBackup() {
	const clientList = CONFIG[`clientList`].map((client) => client.clientName);
	const expireLimitDays = 30;
	for (const client of clientList) {
		FS.readdir(`${BACKUP_PATH}/${client}/backup`, (err, dates) => {
			if (err) throw err;

			dates.forEach((date) => {
				const now = new Date(
					new Date().getTime() -
						new Date().getTimezoneOffset() * 60000
				);
				const currentDate = now
					.toISOString()
					.replace(/\:+/g, '-')
					.slice(0, 10);
				let dateDiff = parseInt(
					Math.abs(new Date(currentDate) - new Date(date)) /
						1000 /
						60 /
						60 /
						24
				);

				if (dateDiff > expireLimitDays)
					FS.rmSync(`${BACKUP_PATH}/${client}/backup/${date}`, {
						recursive: true,
						force: true,
					});
			});
		});
	}
}

/*
    Run all necessary processes.
*/
function runProcesses() {
	const cameras = buildCctvCameras().filter((camera) => camera.type !== 'rtmp');
	const seen = new Set();
	cameras.forEach((camera) => {
		if (seen.has(camera.id)) return;
		seen.add(camera.id);
		RTSPToRTSP(camera.sourceUrl, camera.type, camera.id);
	});

	if (CONFIG.h264RtspList.length > 0) {
		CONFIG.h264RtspList.forEach((rtsp) => {
			if (CONVERT_LIVE_STREAM_TO_MP4) {
				RTSPToMP4(rtsp, 'h264');
			}
		});
	}

	if (CONFIG.hevcRtspList.length > 0) {
		CONFIG.hevcRtspList.forEach((rtsp) => {
			if (CONVERT_LIVE_STREAM_TO_MP4) {
				RTSPToMP4(rtsp, 'hevc');
			}
		});
	}
}

APP.use(CORS());
APP.use(EXPRESS.json());
APP.use(EXPRESS.static(__dirname));

APP.get('/cctv/cameras', (req, res) => {
	try {
		res.json(buildCctvCameras().map(publicCamera));
	} catch (err) {
		console.error('[ERROR] Failed to list CCTV cameras:', err);
		res.status(500).json({ error: err.message });
	}
});

APP.patch('/cctv/cameras/:id', (req, res) => {
	const sourceConfig = JSON.parse(FS.readFileSync(CONFIG_PATH, 'utf8'));
	const entry = findCctvConfigEntry(sourceConfig, req.params.id);
	if (!entry) return res.status(404).json({ error: 'camera not found' });

	const name = String(req.body.name || '').trim();
	if (!name) return res.status(400).json({ error: 'name required' });
	if (name.length > 80) return res.status(400).json({ error: 'name too long' });

	entry.client.cameraName = name;
	delete sourceConfig.clientList;
	delete sourceConfig.rtmpList;
	delete sourceConfig.h264RtspList;
	delete sourceConfig.hevcRtspList;
	delete sourceConfig.allRtspList;
	FS.writeFileSync(CONFIG_PATH, JSON.stringify(sourceConfig, null, 4));
	setRtspList();
	res.json(publicCamera(findCctvCamera(req.params.id)));
});

APP.post('/cctv/cameras/:id/snapshot', (req, res) => {
	const camera = findCctvCamera(req.params.id);
	if (!camera) return res.status(404).json({ error: 'camera not found' });
	if (CCTV_SNAP_COMMANDS[camera.id]) {
		return res.status(202).json(publicCamera(camera));
	}

	const dir = PATH.join(CCTV_DATA_PATH, camera.id);
	const coverPath = PATH.join(dir, 'cover.jpg');
	const tmpPath = PATH.join(dir, 'cover.tmp.jpg');
	ensureDir(dir);

	if (FS.existsSync(tmpPath)) FS.rmSync(tmpPath, { force: true });

	let finished = false;
	const command = FFMPEG(camera.snapshotUrl)
		.noAudio()
		.outputOptions('-y', '-vf', 'thumbnail=10', '-frames:v', '1', '-q:v', '3')
		.on('start', (cmd) => {
			console.log(`[INFO] CCTV snapshot ${camera.id}: ${cmd}`);
		})
		.on('end', () => {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			delete CCTV_SNAP_COMMANDS[camera.id];

			let snapshotUpdated = false;
			if (FS.existsSync(tmpPath) && FS.statSync(tmpPath).size > 0) {
				const quality = checkSnapshotQuality(tmpPath);
				if (quality.ok) {
					FS.renameSync(tmpPath, coverPath);
					snapshotUpdated = true;
				} else {
					FS.rmSync(tmpPath, { force: true });
					console.warn(`[WARN] CCTV snapshot rejected ${camera.id}: ${quality.reason}`);
				}
			}

			res.json({
				...publicCamera(findCctvCamera(camera.id)),
				snapshotUpdated,
			});
		})
		.on('error', (err) => {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			delete CCTV_SNAP_COMMANDS[camera.id];
			if (FS.existsSync(tmpPath)) FS.rmSync(tmpPath, { force: true });
			console.warn(`[WARN] CCTV snapshot failed ${camera.id}: ${err.message}`);
			res.status(502).json(publicCamera(findCctvCamera(camera.id)));
		});

	if (camera.type !== 'rtmp') {
		command.addInputOption('-rtsp_transport', 'tcp');
	}

	const timeout = setTimeout(() => {
		if (finished) return;
		finished = true;
		stopTrackedCommand(CCTV_SNAP_COMMANDS, camera.id);
		delete CCTV_SNAP_COMMANDS[camera.id];
		if (FS.existsSync(tmpPath)) FS.rmSync(tmpPath, { force: true });
		console.warn(`[WARN] CCTV snapshot timeout ${camera.id}`);
		res.status(504).json(publicCamera(findCctvCamera(camera.id)));
	}, CCTV_SNAPSHOT_TIMEOUT_MS);

	CCTV_SNAP_COMMANDS[camera.id] = { command };
	command.save(tmpPath);
});

APP.post('/cctv/cameras/:id/recordings', (req, res) => {
	const camera = findCctvCamera(req.params.id);
	if (!camera) return res.status(404).json({ error: 'camera not found' });
	if (CCTV_RECORD_COMMANDS[camera.id]) {
		return res.status(409).json({ error: 'recording already running' });
	}

	const durationSec = Math.max(5, Math.min(Number(req.body.durationSec) || 600, 86400));
	const dir = PATH.join(CCTV_DATA_PATH, camera.id);
	const replayPath = PATH.join(dir, 'replay.mp4');
	const tmpPath = PATH.join(dir, 'replay.tmp.mp4');
	const metaPath = PATH.join(dir, 'replay.json');
	const startedAt = new Date();
	ensureDir(dir);
	if (FS.existsSync(tmpPath)) FS.rmSync(tmpPath, { force: true });

	const finish = (ok, err) => {
		const state = CCTV_RECORD_COMMANDS[camera.id];
		if (!state) return;

		clearTimeout(state.timeout);
		delete CCTV_RECORD_COMMANDS[camera.id];

		const hasFile = FS.existsSync(tmpPath) && FS.statSync(tmpPath).size > 0;
		if (ok && hasFile) {
			FS.renameSync(tmpPath, replayPath);
			const endedAt = new Date();
			const metadata = {
				cameraId: camera.id,
				cameraName: camera.name,
				ip: camera.ip,
				startedAt: startedAt.toISOString(),
				endedAt: endedAt.toISOString(),
				durationSec: Math.round((endedAt - startedAt) / 1000),
				targetDurationSec: durationSec,
				stoppedEarly: state.stopping,
			};
			FS.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
			console.log(`[INFO] CCTV replay saved ${camera.id}: ${replayPath}`);
			return;
		}

		if (FS.existsSync(tmpPath)) FS.rmSync(tmpPath, { force: true });
		if (err) console.warn(`[WARN] CCTV recording failed ${camera.id}: ${err.message}`);
	};

	const command = FFMPEG(camera.recordUrl)
		.noAudio()
		.videoCodec('libx264')
		.outputOptions(
			'-t',
			String(durationSec),
			'-preset',
			'veryfast',
			'-pix_fmt',
			'yuv420p',
			'-movflags',
			'faststart',
			'-avoid_negative_ts',
			'make_zero'
		)
		.on('start', (cmd) => {
			console.log(`[INFO] CCTV recording ${camera.id}: ${cmd}`);
		})
		.on('end', () => finish(true))
		.on('error', (err) => {
			const state = CCTV_RECORD_COMMANDS[camera.id];
			finish(Boolean(state && state.stopping), err);
		});

	if (camera.type !== 'rtmp') {
		command.addInputOption('-rtsp_transport', 'tcp');
	}

	CCTV_RECORD_COMMANDS[camera.id] = {
		command,
		startedAt,
		durationSec,
		stopping: false,
		timeout: setTimeout(() => stopTrackedCommand(CCTV_RECORD_COMMANDS, camera.id, 'SIGINT'), (durationSec + 15) * 1000),
	};
	command.save(tmpPath);

	res.json({
		id: camera.id,
		startedAt: startedAt.toISOString(),
		durationSec,
	});
});

APP.post('/cctv/cameras/:id/recordings/stop', (req, res) => {
	const camera = findCctvCamera(req.params.id);
	if (!camera) return res.status(404).json({ error: 'camera not found' });
	if (!stopTrackedCommand(CCTV_RECORD_COMMANDS, camera.id, 'SIGINT')) {
		return res.status(409).json({ error: 'not recording' });
	}

	setTimeout(() => res.json(publicCamera(findCctvCamera(camera.id))), 1200);
});

APP.delete('/cctv/cameras/:id/replay', (req, res) => {
	const camera = findCctvCamera(req.params.id);
	if (!camera) return res.status(404).json({ error: 'camera not found' });
	if (CCTV_RECORD_COMMANDS[camera.id]) {
		return res.status(409).json({ error: 'recording now' });
	}

	const dir = PATH.join(CCTV_DATA_PATH, camera.id);
	FS.rmSync(PATH.join(dir, 'replay.mp4'), { force: true });
	FS.rmSync(PATH.join(dir, 'replay.json'), { force: true });
	res.json(publicCamera(findCctvCamera(camera.id)));
});

APP.get('/forceReloadSystem', (req, res) => {
	try {
		SPAWN(`${PM2_PATH} reload mediaserver --force`, { shell: true });

		// If you enable the Frame Animation function, please uncomment the following code
		SPAWN(`${PM2_PATH} reload rtsp-to-image --force`, { shell: true });

		res.send('success');
	} catch (err) {
		console.log(err);

		res.send(err.message);
		return;
	}
});

APP.post('/updateConfig', (req, res) => {
	const { data } = req.body;
	try {
		// 驗證傳入的資料是否為有效的 JSON
		JSON.parse(data);

		// 1. 先將新設定寫入檔案
		FS.writeFile(CONFIG_PATH, data, (err) => {
			if (err) {
				console.error('[ERROR] Failed to write config file:', err);
				// 如果寫入失敗，回傳錯誤給前端
				return res.status(500).send('Failed to write config file.');
			}

			try {
				setRtspList();
			} catch (reloadErr) {
				console.error('[ERROR] Failed to reload config in memory:', reloadErr);
				return res.status(500).send('Config file written, but failed to reload config.');
			}

			// 2. 寫入成功後，立刻回傳 success 給前端
			res.send('success');
			console.log('[INFO] Config file written, sent success response to client.');

			// 3. 使用一個極短的延遲後，執行重啟命令
			//    這個延遲是為了確保 HTTP 回應有足夠的時間被系統發送出去
			setTimeout(() => {
				console.log('[INFO] Triggering services reload via PM2...');
		                SPAWN(`${PM2_PATH} reload mediaserver --force`, { shell: true });

                		// If you enable the Frame Animation function, please uncomment the following code
		                SPAWN(`${PM2_PATH} reload rtsp-to-image --force`, { shell: true });
			}, 100); // 延遲 100 毫秒
		});

	} catch (err) {
		console.error('[ERROR] Invalid JSON data received for /updateConfig:', err.message);
		res.status(400).send('Invalid JSON data: ' + err.message);
	}
});
SERVER.listen(PORT, '0.0.0.0', () => {
    setRtspList();
    runMediaServer();
	runProcesses();
	if (CONVERT_LIVE_STREAM_TO_MP4) {
		setInterval(clearExpiredBackup, 1000 * 60 * 5);
	}
});

/*
    When the program terminates, clear the related background programs.
*/
function cleanupAndExit() {
	console.log(
		'Received exit signal. Gracefully cleaning up all running ffmpeg and MediaServer processes...'
	);

    // 終止 ZLMediaKit 伺服器
    SPAWN('killall -9 MediaServer', {
        shell: true,
    });

	Object.keys(CCTV_RECORD_COMMANDS).forEach((id) => {
		stopTrackedCommand(CCTV_RECORD_COMMANDS, id, 'SIGINT');
	});
	Object.keys(CCTV_SNAP_COMMANDS).forEach((id) => {
		stopTrackedCommand(CCTV_SNAP_COMMANDS, id);
	});

	const all_processes = { ...RTSP_COMMANDS, ...MP4_COMMANDS };
	const running_ids = Object.keys(all_processes);

	if (running_ids.length === 0) {
		console.log('No ffmpeg processes to kill.');
        setTimeout(() => process.exit(0), 500);
		return;
	}

	running_ids.forEach((id) => {
		const item = all_processes[id];
		const cmd = item && item.command ? item.command : item;
		if (cmd) {
			console.log(`Stopping ffmpeg process for ${id}...`);
			// 在 kill 之前，移除所有事件監聽器，避免觸發自動重試
			if (item.watchdog) clearInterval(item.watchdog);
			cmd.removeAllListeners();
			cmd.kill('SIGTERM'); // 使用 SIGTERM 優雅地終止
		}
	});

    // 清空追蹤物件
    RTSP_COMMANDS = {};
    MP4_COMMANDS = {};

	// 給予一個短暫的延遲以確保程序退出
	setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);
