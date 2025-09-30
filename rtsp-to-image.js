const FS = require('fs-extra');
const IMAGE_PATH = `./ZLMediaKit/release/linux/Debug/www/image`;
const CONFIG_PATH = `./ZLMediaKit/release/linux/Debug/www/config/config.json`;
const FFMPEG = require('fluent-ffmpeg');
FFMPEG.setFfmpegPath(`./ffmpeg/ffmpeg`);
const IMAGE_COMMANDS = {};
let CONFIG = {};

/*
    Convert the original RTSP stream to a format acceptable.
*/
function RTSPToImage(rtsp) {
	const ip = rtsp.split('@').pop();
	const id = ip.match(/\d+/g).join('');
	const input = `rtsp://localhost:9554/live/${ip}`;
	const output = `${IMAGE_PATH}/${id}.jpg`;

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
		.addOutputOption('-update', '1')
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
				RTSPToImage(rtsp);
			}, 5000);
		})
		.on('error', function (err, stdout, stderr) {
			console.error(
				`[ERROR] FFMPEG process for ${id} failed:`,
				err.message
			);
			delete IMAGE_COMMANDS[id];

			setTimeout(() => {
				console.log(`[INFO] Retrying conversion for ${rtsp}...`);
				RTSPToImage(rtsp);
			}, 5000);
		});

	IMAGE_COMMANDS[id] = command;
	command.run();
}

function clearExpiredBackup() {
        const image_path =
                '/home/gini/mediaserver/ZLMediaKit/release/linux/Debug/www/image';
        const thirty_minutes = 30 * 60 * 1000; // 30 minutes in milliseconds

        FS.readdir(image_path, (err, files) => {
                if (err) {
                        console.error('Failed to read the dirctory:', err);
                        return;
                }

                const now = Date.now(); // Current time in milliseconds

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

setRtspList();

if (CONFIG.allRtspList.length > 0) {
	for (const rtsp of CONFIG.allRtspList) {
		RTSPToImage(rtsp);
	}
}

setInterval(clearExpiredBackup, 300000);
clearExpiredBackup();

function cleanupAndExit() {
	console.log(
		'Received exit signal. Cleaning up all running ffmpeg processes...'
	);
	const running_processes = Object.keys(IMAGE_COMMANDS);
	if (running_processes.length === 0) {
		console.log('No ffmpeg processes to kill.');
		process.exit(0);
	}

	running_processes.forEach((id) => {
		console.log(`Killing ffmpeg process for ${id}...`);
		IMAGE_COMMANDS[id].kill('SIGKILL'); // Force kill
		delete IMAGE_COMMANDS[id];
	});

	// Give a moment for processes to be killed before exiting
	setTimeout(() => process.exit(0), 100);
}

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);
