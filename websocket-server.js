const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const port = 4000;

const screenshotDir = './ZLMediaKit/release/linux/Debug/www/image/';
let clients = []; // Store all WebSocket connections
const fileTimestamps = {}; // Used to check if the file has been updated

// Create the HTTP server
const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', function connection(ws) {
    console.log('Client connected');
    clients.push(ws);

    // Receive the device ID list sent by the frontend
    ws.on('message', function incoming(message) {
        try {
            const requestData = JSON.parse(message);
            if (!requestData.ips || !Array.isArray(requestData.ips)) {
                console.error('Invalid request format:', message);
                return;
            }

            console.log('Received device IDs:', requestData.ips);

            // Check the image files of all devices
            requestData.ips.forEach(ip => {
                const filePath = path.join(screenshotDir, `${ip}.jpg`);

                // Initialize the timestamp
                if (!fileTimestamps[ip]) {
                    fileTimestamps[ip] = 0;
                }

                // Check if the file has been updated
                fs.stat(filePath, (err, stats) => {
                    if (err) return;

                    const lastModified = stats.mtimeMs;
                    if (lastModified > fileTimestamps[ip]) {
                        fileTimestamps[ip] = lastModified;

                        // Read the image and send it to all connected clients
                        fs.readFile(filePath, (err, data) => {
                            if (err) {
                                console.error('Error reading image:', err);
                                return;
                            }
                            const base64Data = Buffer.from(data).toString('base64');
                            clients.forEach(client => {
                                client.send(JSON.stringify({ [ip]: base64Data }));
                            });
                        });
                    }
                });
            });

        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    // Handle WebSocket disconnection
    ws.on('close', function close() {
        console.log('Client disconnected');
        clients = clients.filter(client => client !== ws);
    });
});

// Start the server
server.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});
