#!/bin/bash
set -euo pipefail

if [ "$EUID" -eq 0 ]; then
	echo "Do not run this script with sudo. Run ./install.sh instead."
	exit 1
fi

# Ask once, then let sudo manage its own credential cache.
sudo -v
while true; do
	sudo -n true
	sleep 60
	kill -0 "$$" || exit
done 2>/dev/null &
SUDO_KEEPALIVE_PID=$!
trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true' EXIT

# Enter mediaserver directory
cd "$(dirname "${BASH_SOURCE[0]}")"

# npm install dependencies
npm i
if ! command -v pm2 >/dev/null 2>&1; then
	npm i -g pm2 || sudo env "PATH=$PATH" npm i -g pm2
fi

# Get the Dependencies
sudo apt -qq update -y
sudo apt -y install autoconf automake build-essential cmake git-core libass-dev libfreetype6-dev libgnutls28-dev libmp3lame-dev libsctp-dev libsdl2-dev libtool libva-dev libvdpau-dev libvorbis-dev libxcb1-dev libxcb-shm0-dev libxcb-xfixes0-dev meson ninja-build pkg-config texinfo wget yasm zlib1g-dev

FFMPEG_VERSION="6.1.1"
FFMPEG_APT_VERSION="$(apt-cache madison ffmpeg | awk -v version="$FFMPEG_VERSION" '$3 ~ "(^|:)" version "([-+]|$)" { print $3; exit }')"
if [ -z "$FFMPEG_APT_VERSION" ]; then
	echo "FFmpeg $FFMPEG_VERSION is not available from apt on this system."
	exit 1
fi

sudo apt -y install "ffmpeg=$FFMPEG_APT_VERSION"
/usr/bin/ffmpeg -version | grep -q "^ffmpeg version $FFMPEG_VERSION"
if [ "$(command -v ffmpeg)" != "/usr/bin/ffmpeg" ]; then
	echo "Warning: PATH uses $(command -v ffmpeg), but mediaserver uses /usr/bin/ffmpeg $FFMPEG_VERSION."
fi

# Enter ZLMediaKit directory
cd ZLMediaKit

# Build and compile the ZLMediaKit
mkdir -p build
cd build
cmake ..
cmake --build . --parallel "$(nproc)"
cd ../..

# Running apps with PM2
pm2 start ecosystem.config.js && pm2 save
