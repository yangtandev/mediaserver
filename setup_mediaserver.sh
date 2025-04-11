#!/bin/bash

# Clean up existing nvidia driver
sudo apt -y autoremove
sudo apt -y remove --purge '^nvidia-.*'
sudo apt -y remove --purge '^cuda-.*'

# Install Nvidia Driver
sudo apt-get -y install nvidia-common
sudo add-apt-repository -y ppa:graphics-drivers
sudo apt -y update
sudo ubuntu-drivers devices
sudo apt -y install nvidia-driver-555

# Install Cuda
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-ubuntu2204.pin
sudo mv cuda-ubuntu2204.pin /etc/apt/preferences.d/cuda-repository-pin-600
wget https://developer.download.nvidia.com/compute/cuda/12.5.0/local_installers/cuda-repo-ubuntu2204-12-5-local_12.5.0-555.42.02-1_amd64.deb
sudo dpkg -i cuda-repo-ubuntu2204-12-5-local_12.5.0-555.42.02-1_amd64.deb
sudo cp /var/cuda-repo-ubuntu2204-12-5-local/cuda-*-keyring.gpg /usr/share/keyrings/
sudo apt-get update
sudo apt-get -y install cuda-toolkit-12-5
sudo rm -rf cuda-ubuntu2204.pin cuda-repo-ubuntu2204-12-5-local_12.5.0-555.42.02-1_amd64.deb

# Enter mediaserver directory
cd $HOME/mediaserver || exit

# npm install dependencies
npm i && npm i pm2 -g

# Clone nvidia-patch
git clone https://github.com/keylase/nvidia-patch.git

# Patch driver
cd nvidia-patch && sudo ./patch.sh && cd $HOME/mediaserver || exit

# Clone ffnvcodec
git clone https://git.videolan.org/git/ffmpeg/nv-codec-headers.git

# Install ffnvcodec
cd nv-codec-headers && sudo make install && cd $HOME/mediaserver || exit

# Configure environment
echo 'export PATH=/usr/local/cuda/bin${PATH:+:${PATH}}' >> $HOME/.bashrc
echo 'export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/usr/local/cuda/lib64' >> $HOME/.bashrc

# Reload configuration
source $HOME/.bashrc
sudo ldconfig

# Get the Dependencies
sudo apt -qq update -y && sudo apt -y install autoconf automake build-essential cmake git-core libass-dev libfreetype6-dev libgnutls28-dev libmp3lame-dev libsdl2-dev libtool libva-dev libvdpau-dev libvorbis-dev libxcb1-dev libxcb-shm0-dev libxcb-xfixes0-dev meson ninja-build pkg-config texinfo wget yasm zlib1g-dev

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
