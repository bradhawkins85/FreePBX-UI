#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure base packages
apt update
DEBIAN_FRONTEND=noninteractive apt install -y git curl ufw fail2ban

# Install Node.js 18 if missing
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt install -y nodejs
fi

# Install PM2 globally if missing
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
  pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null
fi

# Update UI source and dependencies
git pull --ff-only || true
npm install

# Start or reload the UI with PM2 and watch for changes
if pm2 describe freepbx-ui >/dev/null 2>&1; then
  pm2 reload freepbx-ui
else
  pm2 start npm --name freepbx-ui --watch -- run dev
fi
pm2 save
