const express = require('express');
const { spawn } = require('child_process');
const axios = require('axios');
const cors = require('cors');

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

const RTSP_URL = 'rtsp://admin:!QAZ87518499@192.168.1.101';
const API_URL =
	'https://jenyi-xg.api.ginibio.com/api/v1/accesses/clothing_logs/';

// Function to format the timestamp
const getFormattedTimestamp = () => {
	const d = new Date();
	const pad = (n) => (n < 10 ? '0' + n : n);
	const padMs = (n) => (n < 10 ? '00' + n : n < 100 ? '0' + n : n);

	const timeZoneOffset = 8; // UTC+8
	const dOffset = new Date(d.getTime() + timeZoneOffset * 3600 * 1000);

	const year = dOffset.getUTCFullYear();
	const month = pad(dOffset.getUTCMonth() + 1);
	const day = pad(dOffset.getUTCDate());
	const hours = pad(dOffset.getUTCHours());
	const minutes = pad(dOffset.getUTCMinutes());
	const seconds = pad(dOffset.getUTCSeconds());
	const microseconds = padMs(dOffset.getUTCMilliseconds()) + '000'; // Simulate microseconds

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${microseconds}+08`;
};

app.get('/capture', async (req, res) => {
	const ffmpeg = spawn('ffmpeg', [
		'-i',
		RTSP_URL,
		'-frames:v',
		'1',
		'-vf',
		'scale=320:-1',
		'-f',
		'image2pipe',
		'pipe:1',
	]);

	let imageChunks = [];
	ffmpeg.stdout.on('data', (chunk) => {
		imageChunks.push(chunk);
	});

	ffmpeg.stderr.on('data', (data) => {
		// console.error(`ffmpeg stderr: ${data}`);
	});

	ffmpeg.on('close', async (code) => {
		if (code !== 0) {
			return res
				.status(500)
				.json({ error: 'Failed to capture image from RTSP stream.' });
		}

		const imageBuffer = Buffer.concat(imageChunks);
		const base64Image = imageBuffer.toString('base64');

		const payload = {
			location: 10089,
			status: 'not_success',
			timestamp: getFormattedTimestamp(),
			image: base64Image,
		};

		// console.log('payload:', payload);

		try {
			await axios.post(API_URL, payload, {
				headers: { 'Content-Type': 'application/json' },
			});
			console.log('Successfully posted to ginibio API.');
		} catch (error) {
			console.error(
				'Error posting to ginibio API:',
				error.response ? error.response.data : error.message
			);
			// We still return the image to the frontend even if the API call fails
		}

		res.json({ image: base64Image });
	});

	ffmpeg.on('error', (err) => {
		// console.error('Failed to start ffmpeg process.', err);
		res.status(500).json({ error: 'Failed to start ffmpeg process.' });
	});
});

app.listen(port, () => {
	console.log(
		`RTSP to Image API server listening at http://localhost:${port}`
	);
});
