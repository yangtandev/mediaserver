const SPAWN = require('child_process').spawn;
const FETCH = (...args) =>
	import('node-fetch').then(({ default: fetch }) => fetch(...args));
const MEDIA_SERVER_PATH = './ZLMediaKit/release/linux/Debug/MediaServer';

(function runMediaServer() {
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
						(str.includes('RTSP') || str.includes('RTMP'))
				);

			console.log('1111:', dataList);
		} else if (rawData.includes('媒体注销') && rawData.includes('rtsp:')) {
			dataList = rawData
				.split(' ')
				.filter(
					(str) =>
						str.includes('__defaultVhost__') &&
						str.includes('rtsp:')
				)
				.map((str) => str.match(/媒体注销:(rtsp:\/\/[^\x1B|\s]+)/)[0]);

			console.log('2222:', dataList);
		} else if (rawData.includes('媒体注销') && rawData.includes('rtmp:')) {
			dataList = rawData
				.split(' ')
				.filter(
					(str) =>
						str.includes('__defaultVhost__') &&
						str.includes('rtmp:')
				)
				.map((str) => str.match(/媒体注销:(rtmp:\/\/[^\x1B|\s]+)/)[0]);

			console.log('3333:', dataList);
		}

		if (dataList.length > 0) {
			dataList = dataList.map((data) => {
				if (data.includes('drone')) {
					data = 'drone';
				} else {
					data = data.match(/\d/g).join('');
				}
				return data;
			});

			console.log('4444:', dataList);

			for (const data of dataList) {
				const body = {
					data: data,
				};
				const url = `http://localhost:3000/reloadFFmpeg`;
				const response = FETCH(url, {
					method: 'POST',
					body: JSON.stringify(body),
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}
	});
})();

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
