const axios = require('axios');
const fs = require('fs');
const path = require('path');

const REMOTE_URL = 'http://111.70.11.75:9080/image/';
const LOCAL_DIR = './ZLMediaKit/release/linux/Debug/www/image';

// 取得遠端目錄檔案清單（需遠端支援列目錄，否則需有檔名清單）
/*async function fetchRemoteList() {
	try {
		const res = await axios.get(REMOTE_URL, { timeout: 3000 });
		const matches = res.data.match(/href="([^"]+)"/gi) || [];
		return matches
			.map((m) => {
				const encoded = m.match(/href="([^"]+)"/)[1];
				return decodeURIComponent(encoded);
			})
			.filter((name) => name.toLowerCase().endsWith('.jpg'));
	} catch (e) {
		console.error('fetchRemoteList failed:', e.message);
		return [];
	}
}*/

async function fetchRemoteList() {
        const targetFiles = [
                '1921683151.jpg',
                '1921683152.jpg',
                '1921683153.jpg',
                '1921683154.jpg',
                '1921683155.jpg'
        ];

        try {
                const res = await axios.get(REMOTE_URL, { timeout: 3000 });
                const matches = res.data.match(/href="([^"]+)"/gi) || [];

                return matches
                        .map((m) => {
                                const encoded = m.match(/href="([^"]+)"/)[1];
                                return decodeURIComponent(encoded);
                        })
                        .filter((name) => targetFiles.includes(name));
        } catch (e) {
                console.error('fetchRemoteList failed:', e.message);
                return [];
        }
}

let syncing = false;
async function syncImages() {
	if (syncing) return;
	syncing = true;
	try {
		const files = await fetchRemoteList();
		if (files.length === 0) return;
		const latestFiles = files.sort();
//		const latestFiles = files.sort().slice(-5);
		for (const file of latestFiles) {
			const url = REMOTE_URL + file;
			const localPath = path.join(LOCAL_DIR, file);
			const tmpPath = localPath + '.tmp';
			try {
				// 確保目錄存在
				fs.mkdirSync(LOCAL_DIR, { recursive: true });
				const response = await axios.get(url, {
					responseType: 'stream',
					timeout: 5000,
				});
				await Promise.race([
					new Promise((resolve, reject) => {
						const writer = fs.createWriteStream(tmpPath);
						response.data.pipe(writer);
						writer.on('finish', resolve);
						writer.on('error', reject);
					}),
					new Promise((_, reject) =>
						setTimeout(
							() => reject(new Error('stream timeout')),
							5000
						)
					),
				]);
				if (fs.existsSync(tmpPath)) {
					fs.renameSync(tmpPath, localPath);
				}
			} catch (e) {
				console.error('Failed to sync', file, e.message);
				if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
			}
		}
	} finally {
		syncing = false;
	}
}

setInterval(syncImages, 1000);
