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
			'-y'
		)
		.addOutputOption('-vf', 'fps=1,scale=1920:-1', '-update', '1')
		.output(output)
		.on('start', function (cmd) {
			console.log(`[INFO] Started ffmpeg for ${id}: ${cmd}`);
		})
		.on('end', function () {
			console.log(
				`[INFO] FFMPEG process for ${id} finished successfully.`
			);
			delete IMAGE_COMMANDS[id];
		})
		.on('error', function (err, stdout, stderr) {
			console.error(
				`[ERROR] FFMPEG process for ${id} failed:`,
				err.message
			);
			delete IMAGE_COMMANDS[id];

			// Automatically restart after a delay
			setTimeout(() => {
				console.log(`[INFO] Retrying conversion for ${rtsp}...`);
				RTSPToImage(rtsp);
			}, 5000);
		});

	IMAGE_COMMANDS[id] = command;
	command.run();
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
