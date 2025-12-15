#!/bin/bash

# Enter mediaserver directory
cd $HOME/mediaserver || exit

# npm install dependencies
npm i && npm i pm2 -g

# Get the Dependencies
sudo apt -qq update -y && sudo apt -y install autoconf automake build-essential cmake git-core libass-dev libfreetype6-dev libgnutls28-dev libmp3lame-dev libsdl2-dev libtool libva-dev libvdpau-dev libvorbis-dev libxcb1-dev libxcb-shm0-dev libxcb-xfixes0-dev meson ninja-build pkg-config texinfo wget yasm zlib1g-dev ffmpeg

# Enter ZLMediaKit directory
cd $HOME/mediaserver/ZLMediaKit || exit

# Build and compile the ZLMediaKit
mkdir build
cd build
cmake ..
make -j4
cd $HOME/mediaserver || exit

# Running apps with PM2
pm2 start ecosystem.config.js && pm2 save
