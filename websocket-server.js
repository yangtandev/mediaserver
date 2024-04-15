const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const port = 4000;

// Image directory
const screenshotDir = './ZLMediaKit/release/linux/Debug/www/image/';

// Create HTTP server
const server = http.createServer();

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections
wss.on('connection', function connection(ws) {
	console.log('Client connected');

	// Listen for filename parameter sent from the frontend
	ws.on('message', function incoming(filename) {
		console.log('Received filename from client:', filename);

		// Listen for changes to the corresponding image file
		const filePath = `${screenshotDir}/${filename}.jpg`;
		fs.watch(filePath, (eventType, filename) => {
			if (eventType === 'change') {
				// Confirm file existence
				fs.access(filePath, fs.constants.F_OK, (err) => {
					if (!err) {
						// Read the image file and send it to the client
						fs.readFile(filePath, (err, data) => {
							if (err) {
								console.error('Error reading image:', err);
								return;
							}
							// Encode image data to base64
							const base64Data =
								Buffer.from(data).toString('base64');
							// Send base64 image data to the client
							ws.send(base64Data);
						});
					}
				});
			}
		});
	});

	// Handle client disconnection
	ws.on('close', function close() {
		console.log('Client disconnected');
	});
});

// Start the HTTP server
server.listen(port, '0.0.0.0', () => {
	console.log('Server is running on port 5000');
});
