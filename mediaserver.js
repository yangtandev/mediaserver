const SPAWN = require('child_process').spawn;
const FETCH = (...args) =>
	import('node-fetch').then(({ default: fetch }) => fetch(...args));
const DOMAIN_NAME = 'stream.ginibio.com'; // Replace it with your registered domain name.
const IS_HTTPS = false; // If you need to use HTTPS, please change it to true
const MEDIA_SERVER_PATH = './ZLMediaKit/release/linux/Debug/MediaServer';
const SSL_PATH = './certificates/ssl.pem';

(function runMediaServer() {
	const command = IS_HTTPS
		? `${MEDIA_SERVER_PATH} -s ${SSL_PATH}`
		: `${MEDIA_SERVER_PATH}`;
	const mediaServer = SPAWN(command, {
		shell: true,
	});

	mediaServer.stdout.on('data', (rawData) => {
		rawData = `${rawData}`;
		
		if (rawData.includes('__defaultVhost__')) {
			console.log(rawData);
		}

		if (
			rawData.includes('断开') &&
			rawData.includes('no such stream')
			// !(
			// 	// rawData.includes('no such stream') ||
			// 	rawData.includes('end of file') ||
			// 	rawData.includes('媒体注销')
			// )
		) {
			const data = rawData
				.split(' ')
				.find(
					(str) =>
						str.includes('__defaultVhost__') &&
						(str.includes('RTSP') ||
							str.includes('rtsp') ||
							str.includes('rtmp'))
				);

			if (data) {
				const body = {
					data: data,
				};
				const url = IS_HTTPS
					? `https://${DOMAIN_NAME}:3000/reloadFFmpeg`
					: `http://localhost:3000/reloadFFmpeg`;
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
