/* 
    Express.js & Node.js
*/
const { spawn } = require('child_process');
const fetch = (...args) =>
	import('node-fetch').then(({ default: fetch }) => fetch(...args));

/*
    Paths
*/
const pm2Path = `$HOME/.nvm/versions/node/v14.16.1/bin/pm2`;
const sslPath = './certificates/ssl.pem';
const mediaServerPath = './ZLMediaKit/release/linux/Debug/MediaServer';

/*
    Run media server。
*/
(function runMediaServer() {
	const mediaServer = spawn(`${mediaServerPath} -s ${sslPath}`, {
		shell: true,
	});

	mediaServer.stdout.on('data', (rawData) => {
		rawData = `${rawData}`;
		console.log(rawData);

		if (
			// rawData.includes('no such stream') ||
			rawData.includes('end of file') ||
			rawData.includes('pusher session timeout')
		) {
			const data = rawData
				.split(' ')
				.find(
					(str) =>
						str.includes('__defaultVhost__') &&
						(str.includes('RTSP') || str.includes('rtsp'))
				);

			if (data) {
				const body = {
					data: data,
				};
				const response = fetch(
					'https://stream.ginibio.com:3000/reloadFFmpeg',
					{
						method: 'POST',
						body: JSON.stringify(body),
						headers: { 'Content-Type': 'application/json' },
					}
				);
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
	const killProcesses = spawn('killall -1 MediaServer', {
		shell: true,
	});

	// Terminate all zombie processes.
	const killZombieProcesses = spawn(
		`ps -Al | grep -w Z | awk '{print $4}' | xargs sudo kill -9`,
		{
			shell: true,
		}
	);
});
