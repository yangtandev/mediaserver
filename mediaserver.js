const FS = require('fs');
const SPAWN = require('child_process').spawn;
const FETCH = (...args) =>
        import('node-fetch').then(({ default: fetch }) => fetch(...args));
const MEDIA_SERVER_PATH = './ZLMediaKit/release/linux/Debug/MediaServer';
const CONFIG_PATH = `./ZLMediaKit/release/linux/Debug/www/config/config.json`;
const { RTSPToRTSP } = require('./media-stream-converter.js');
let CONFIG = {};

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

function runMediaServer() {
	const command = `${MEDIA_SERVER_PATH}`;
	const mediaServer = SPAWN(command, {
		shell: true,
	});

	mediaServer.stdout.on('data', (rawData) => {
		rawData = `${rawData}`;

		if (
			rawData.includes('__defaultVhost__') &&
			(rawData.includes('RTSP') ||
				rawData.includes('rtsp:') ||
				rawData.includes('rtmp'))
		) {
			console.log(rawData);
		}

		let dataList = [];

		if (
			rawData.includes('断开') &&
			(rawData.includes('no such stream') ||
				rawData.includes('pusher session timeout'))
		) {
			dataList = rawData
				.split(' ')
				.filter(
					(str) =>
						str.includes('__defaultVhost__') &&
						str.includes('RTSP') 
				);

			console.log('1111:', dataList);
		} else if (rawData.includes('媒体注销') && rawData.includes('rtsp:')) {
			dataList = rawData
				.split(' ')
				.filter(
					(str) =>
						str.includes('__defaultVhost__') &&
						str.includes('rtsp:') &&
						str.includes('媒体注销:')
				)
				.map((str) => str.match(/媒体注销:(rtsp:\/\/[^\x1B|\s]+)/)[0]);

			console.log('2222:', dataList);
		} 
		
		if (dataList.length > 0) {
			dataList = dataList.map((data) => data.match(/\d/g).join(''));
			
			console.log('3333:', dataList);

			for (const data of dataList) {
				for (const type of ['h264', 'hevc']) {
                                    const rtsp = CONFIG[`${type}RtspList`].find(
                                        (rtsp) =>
                                                rtsp
                                                .split('@')
                                                .pop()
                                                .split('/')
                                                .shift()
                                                .match(/\d/g)
                                                .join('') == data.match(/\d/g).join('')                                    
				    );

                                    if (rtsp) {
                                        console.log(data);
                                        RTSPToRTSP(rtsp, type);
                                    }
                                }
			}
		}
	});
};

(()=>{
        setRtspList()
        runMediaServer()
})()

/* 
    When the program terminates, clear the related background programs.
*/
process.on('SIGINT', (code) => {
	String('SIGINT')
		.split('')
		.forEach((word) => {
			const slashes = String('|').repeat(30);
			console.log(`${slashes} ${word} ${slashes}`);
		});

	// Terminate all processes related to media server.
	const killProcesses = SPAWN('killall -1 MediaServer', {
		shell: true,
	});

	// Terminate all zombie processes.
	const killZombieProcesses = SPAWN(
		`ps -Al | grep -w Z | awk '{print $4}' | xargs sudo kill -9`,
		{
			shell: true,
		}
	);
});
