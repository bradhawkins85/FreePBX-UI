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

# Install FreePBX/Asterisk (run only if not already installed)
if [[ ! -f /etc/freepbx.conf ]]; then
  bash "$SCRIPT_DIR/install_freepbx_asterisk_ubuntu24.sh"
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

# Configure UFW firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw limit 22/tcp
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 5060/udp comment 'SIP-UDP'
ufw allow 5061/tcp comment 'SIP-TLS'
ufw allow 10000:20000/udp comment 'RTP range'
echo "y" | ufw enable
ufw status verbose

# Configure Fail2Ban
cat <<'JAIL' >/etc/fail2ban/jail.local
[DEFAULT]
# Ban policy: extend as needed
bantime  = 24h
findtime = 10m
maxretry = 6
backend  = auto
# If you use UFW, this integrates nicely:
banaction = ufw
# Whitelist trusted subnets (LAN/VPN/admin IPs)
ignoreip = 127.0.0.1/8 ::1 192.168.0.0/16 10.0.0.0/8

# --- SSH ---
[sshd]
enabled  = true
port     = ssh
logpath  = /var/log/auth.log
maxretry = 5

# --- Apache (FreePBX GUI auth, basic) ---
[apache-auth]
enabled  = true
port     = http,https
logpath  = /var/log/apache2/*error.log
maxretry = 6

# --- Asterisk SIP brute-force / bad REGISTERs ---
[asterisk]
enabled  = true
port     = 5060,5061
protocol = all
logpath  = /var/log/asterisk/full
#journalmatch = _COMM=asterisk
backend  = auto
maxretry = 6
findtime = 10m
bantime  = 24h

# Re-offenders get a longer ban
[recidive]
enabled  = true
logpath  = /var/log/fail2ban.log
bantime  = 1w
findtime = 1d
maxretry = 5
JAIL

cat <<'FILTER' >/etc/fail2ban/filter.d/asterisk.conf
# Fail2Ban filter for Asterisk/PJSIP
# Matches common failed registration/auth and scanning attempts in /var/log/asterisk/full

[Definition]
failregex = ^.*NOTICE.*: .*: Registration from '.*' failed for '<HOST>[:\d]*' - (Wrong password|No matching endpoint found|Device not found|Username/auth name mismatch).*
            ^.*WARNING.*: .*: (Rejecting unknown SIP connection from|No matching peer found for) '.*' from '<HOST>[:\d]*'.*
            ^.*NOTICE.*: .*: Failed to authenticate device .* from '<HOST>[:\d]*'.*
            ^.*ERROR.*: .*: PJ_.*: .* authentication failed for .* \(scheme:.*\) from '<HOST>[:\d]*'.*
            ^.*NOTICE.*: .*: Request 'REGISTER' from '.*' failed for '<HOST>[:\d]*'.*
ignoreregex =

# Optionally tighten matching to REGISTER/INVITE only:
# journalmatch =
FILTER

# Restart Fail2Ban to load the new jail/filter and verify
systemctl enable --now fail2ban
systemctl restart fail2ban
fail2ban-client status
fail2ban-client status asterisk
fail2ban-client status sshd
fail2ban-client status apache-auth
fail2ban-regex /var/log/asterisk/full /etc/fail2ban/filter.d/asterisk.conf || true
