const SPAWN = require("child_process").spawn;
const FETCH = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));
const DOMAIN_NAME = "stream.ginibio.com"; // Replace it with your registered domain name.
const IS_HTTPS = false; // If you need to use HTTPS, please change it to true
const MEDIA_SERVER_PATH = "./ZLMediaKit/release/linux/Debug/MediaServer";
const SSL_PATH = "./certificates/ssl.pem";

(function runMediaServer() {
    const command = IS_HTTPS
        ? `${MEDIA_SERVER_PATH} -s ${SSL_PATH}`
        : `${MEDIA_SERVER_PATH}`;
    const mediaServer = SPAWN(command, {
        shell: true,
    });

    mediaServer.stdout.on("data", (rawData) => {
        let data;
        rawData = `${rawData}`;

        if (
            rawData.includes("__defaultVhost__") &&
            (rawData.includes("RTSP") ||
                rawData.includes("rtsp:") ||
                rawData.includes("rtmp:"))
        ) {
            console.log(rawData);
        }

        if (rawData.includes("断开") && rawData.includes("no such stream")) {
            data = rawData
                .split(" ")
                .find(
                    (str) =>
                        str.includes("__defaultVhost__") && str.includes("RTSP")
                );
        }

        if (rawData.includes("媒体注销")) {
            data = rawData
                .split(" ")
                .find(
                    (str) =>
                        str.includes("__defaultVhost__") &&
                        (str.includes("rtsp:") || str.includes("rtmp:"))
                );

            // Match strings that do not contain the ANSI escape code \x1B and white space characters.
            if (data.includes("rtsp:")) {
                data = data.match(/媒体注销:(rtsp:\/\/[^\x1B|\s]+)/)[0];
            } else if (data.includes("rtmp:")) {
                data = data.match(/媒体注销:(rtmp:\/\/[^\x1B|\s]+)/)[0];
            }
        }

        if (data) {
            const body = {
                data: data,
            };
            const url = IS_HTTPS
                ? `https://${DOMAIN_NAME}/api/reloadFFmpeg`
                : `http://localhost:3000/reloadFFmpeg`;
            const response = FETCH(url, {
                method: "POST",
                body: JSON.stringify(body),
                headers: { "Content-Type": "application/json" },
            });
        }
    });
})();

/* 
    When the program terminates, clear the related background programs.
*/
process.on("SIGINT", (code) => {
    String("SIGINT")
        .split("")
        .forEach((word) => {
            const slashes = String("|").repeat(30);
            console.log(`${slashes} ${word} ${slashes}`);
        });

    // Terminate all processes related to media server.
    const killProcesses = SPAWN("killall -1 MediaServer", {
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
