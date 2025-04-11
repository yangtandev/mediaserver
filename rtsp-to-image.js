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

	if (!FS.existsSync(IMAGE_PATH)) {
		FS.mkdirSync(IMAGE_PATH);
	}

	if (IMAGE_COMMANDS.hasOwnProperty(id)) {
		IMAGE_COMMANDS[id].kill('SIGINT');
	}

	IMAGE_COMMANDS[id] = FFMPEG(input);
	IMAGE_COMMANDS[id]
		.addInputOption(
                        '-rtsp_transport',
                        'tcp',
                        '-vsync',
                        'passthrough',
                        '-rtbufsize',
                        '100M',
                        '-y'
		)
		.addOutputOption(
			'-vf',
			'fps=1,scale=1920:-1',
			'-update',
			'1'
		)
		.output(output)
		.on('stderr', function (err) {
			if (
				err.includes('muxing overhead: unknown') ||
				err.includes('Error muxing a packet')
			) {
				setTimeout(() => {
					RTSPToImage(rtsp);
				}, 5000);
			}
		})
		.on('error', function (err, stdout, stderr) {
			console.log('RTSP', ip, err.message);

			if (
				err.message.includes('Connection refused') ||
				err.message.includes('Conversion failed') ||
				err.message.includes('Connection timed out') ||
				err.message.includes('No route to host') ||
				err.message.includes('Error opening input file') ||
				err.message.includes(
					'Invalid data found when processing input'
				) ||
				err.message.includes('Generic error in an external library')
			) {
				setTimeout(() => {
					RTSPToImage(rtsp);
				}, 5000);
			}
		})
		.run();
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
