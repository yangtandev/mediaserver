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
sudo apt -y install autoconf automake build-essential cmake git-core libass-dev libfreetype6-dev libgnutls28-dev libmp3lame-dev libsctp-dev libsdl2-dev libsrtp2-dev libtool libva-dev libvdpau-dev libvorbis-dev libxcb1-dev libxcb-shm0-dev libxcb-xfixes0-dev meson nasm ninja-build pkg-config texinfo wget xz-utils yasm zlib1g-dev libx264-dev libx265-dev libnuma-dev

FFMPEG_VERSION="6.1.1"
FFMPEG_BIN="/usr/local/bin/ffmpeg"
FFMPEG_SOURCE_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
FFMPEG_SOURCE_SHA256="8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968"

has_ffmpeg_6_1_1() {
	local installed_version
	[ -x "$1" ] || return 1
	installed_version="$("$1" -version 2>/dev/null | awk 'NR == 1 { print $3 }')"
	[[ "$installed_version" == "$FFMPEG_VERSION" || "$installed_version" == "$FFMPEG_VERSION-"* ]]
}

install_ffmpeg_6_1_1() {
	if has_ffmpeg_6_1_1 "$FFMPEG_BIN"; then
		echo "FFmpeg $FFMPEG_VERSION already installed: $FFMPEG_BIN"
		return
	fi
	if has_ffmpeg_6_1_1 /usr/bin/ffmpeg; then
		sudo install -d /usr/local/bin
		sudo ln -sf /usr/bin/ffmpeg "$FFMPEG_BIN"
		sudo ln -sf /usr/bin/ffprobe /usr/local/bin/ffprobe
		echo "FFmpeg $FFMPEG_VERSION already installed: /usr/bin/ffmpeg"
		return
	fi

	local apt_version
	apt_version="$(apt-cache madison ffmpeg | awk -v version="$FFMPEG_VERSION" '$3 ~ "(^|:)" version "([-+]|$)" { print $3; exit }')"
	if [ -n "$apt_version" ] && sudo apt -y --allow-downgrades install "ffmpeg=$apt_version" && has_ffmpeg_6_1_1 /usr/bin/ffmpeg; then
		sudo install -d /usr/local/bin
		sudo ln -sf /usr/bin/ffmpeg "$FFMPEG_BIN"
		sudo ln -sf /usr/bin/ffprobe /usr/local/bin/ffprobe
	else
		local build_dir archive
		build_dir="$(mktemp -d)"
		archive="$build_dir/ffmpeg-${FFMPEG_VERSION}.tar.xz"
		wget -O "$archive" "$FFMPEG_SOURCE_URL"
		echo "$FFMPEG_SOURCE_SHA256  $archive" | sha256sum -c -
		tar -xf "$archive" -C "$build_dir"
		(
			cd "$build_dir/ffmpeg-${FFMPEG_VERSION}"
			./configure --prefix=/usr/local --enable-gpl --enable-libx264 --enable-libx265
			make -j"$(nproc)"
			sudo make install
		)
		rm -rf "$build_dir"
	fi

	if ! has_ffmpeg_6_1_1 "$FFMPEG_BIN"; then
		echo "FFmpeg $FFMPEG_VERSION installation failed."
		exit 1
	fi
	echo "FFmpeg $FFMPEG_VERSION installed: $FFMPEG_BIN"
}

install_ffmpeg_6_1_1

# Enter ZLMediaKit directory
cd ZLMediaKit

# Build and compile the ZLMediaKit
mkdir -p build
cd build
cmake ..
cmake --build . --parallel "$(nproc)"
cd ../..

sed -i 's|^rootPath=.*|rootPath=./www|' ZLMediaKit/release/linux/Debug/config.ini
mkdir -p ZLMediaKit/release/linux/Debug/www/image

# Running apps with PM2
pm2 start ecosystem.config.js && pm2 save
