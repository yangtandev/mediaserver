const FS = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

const IMAGE_PATH = `./ZLMediaKit/release/linux/Debug/www/image`;
const CONFIG_PATH = `./ZLMediaKit/release/linux/Debug/www/config/config.json`;
const FFMPEG = require('fluent-ffmpeg');
FFMPEG.setFfmpegPath(`/usr/bin/ffmpeg`);

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

function RTSPToImage(rtsp, type, useHwAccel = false) {
	const ip = rtsp.split('@').pop();
	const id = ip.match(/\d+/g).join('');
	const input = `rtsp://localhost:9554/live/${ip}`;
	const output = `${IMAGE_PATH}/${id}.jpg`;

	console.warn(`[PERFORMANCE_WARNING] Stream ${id} is configured for high-frequency JPG overwrite. This will cause high I/O and CPU load and is not recommended for production use.`);

	if (IMAGE_COMMANDS.hasOwnProperty(id)) {
		console.log(`[INFO] Conversion for ${id} is already running.`);
		return;
	}

	if (!FS.existsSync(IMAGE_PATH)) {
		FS.mkdirSync(IMAGE_PATH, { recursive: true });
	}

	const command = FFMPEG(input)
		.addInputOption(
			'-rtsp_transport',
			'tcp',
			'-vsync',
			'passthrough',
			'-rtbufsize',
			'20M',
			'-y',
			'-threads',
			1
		)
                .outputFormat('image2') // Use the image2 muxer for image sequence output
                .addOutputOption('-vf', 'fps=15') // Set the frame rate
                .addOutputOption('-update', '1') // Overwrite the same file
		.output(output)
		.on('start', function (cmd) {
			console.log(`[INFO] Started ffmpeg for ${id}: ${cmd}`);
		})
		.on('end', function () {
			console.log(
				`[INFO] FFMPEG process for ${id} finished successfully.`
			);
			delete IMAGE_COMMANDS[id];
			
			setTimeout(() => {
				console.log(`[INFO] Retrying conversion for ${rtsp}...`);
				RTSPToImage(rtsp, type, useHwAccel);
			}, 5000);
		})
		.on('error', function (err, stdout, stderr) {
			console.error(
				`[ERROR] FFMPEG process for ${id} failed:`,
				err.message
			);
			delete IMAGE_COMMANDS[id];

			let retryWithHwAccel = useHwAccel;
			if (useHwAccel && (err.message.includes('qsv') || err.message.includes('Hardware') || err.message.includes('No such device'))) {
                console.log(`[INFO] RTSP-to-Image HW acceleration failed for ${id}. Retrying with software.`);
                retryWithHwAccel = false;
            }

			setTimeout(() => {
				console.log(`[INFO] Retrying conversion for ${rtsp}...`);
				RTSPToImage(rtsp, type, retryWithHwAccel);
			}, 5000);
		});

	if (useHwAccel) {
		command.addInputOption('-hwaccel', 'qsv');
	}

	IMAGE_COMMANDS[id] = command;
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

if (CONFIG.h264RtspList && CONFIG.h264RtspList.length > 0) {
	for (const rtsp of CONFIG.h264RtspList) {
		RTSPToImage(rtsp, 'h264', IS_QSV_SUPPORTED);
	}
}

if (CONFIG.hevcRtspList && CONFIG.hevcRtspList.length > 0) {
	for (const rtsp of CONFIG.hevcRtspList) {
		RTSPToImage(rtsp, 'hevc', IS_QSV_SUPPORTED);
	}
}

setInterval(clearExpiredBackup, 300000);
clearExpiredBackup();

function cleanupAndExit() {
	console.log(
		'Received exit signal. Gracefully cleaning up all running ffmpeg processes...'
	);
	const running_processes = Object.keys(IMAGE_COMMANDS);
	if (running_processes.length === 0) {
		console.log('No ffmpeg processes to kill.');
		return process.exit(0);
	}

	running_processes.forEach((id) => {
		const cmd = IMAGE_COMMANDS[id];
		if (cmd) {
			console.log(`Stopping ffmpeg process for ${id}...`);
			cmd.removeAllListeners();
			cmd.kill('SIGTERM'); 
			delete IMAGE_COMMANDS[id];
		}
	});

	setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);
