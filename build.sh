#!/bin/bash

# Install Python dependencies
apt-get update
apt-get install -y python3 python3-pip
pip3 install -r requirements.txt

# Build Next.js application
npm run build 