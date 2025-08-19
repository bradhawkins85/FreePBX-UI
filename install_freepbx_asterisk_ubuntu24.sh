#!/usr/bin/env bash
set -euo pipefail

# ======================================================================
# FreePBX 17 + Asterisk 20 LTS installer for Ubuntu 24.04 (Noble)
# - Installs PHP 8.2 (per FreePBX 17 requirements), MariaDB, Apache, Node.js 18
# - Builds and installs Asterisk 20 from source
# - Installs FreePBX 17 from the official tarball
# - Configures services to run as 'asterisk' and opens SIP/RTP/HTTP(S) ports
# ======================================================================
# Usage: sudo bash install_freepbx_asterisk_ubuntu24.sh
# Notes:
#   * Run on a fresh Ubuntu 24.04 server/VM as root (or via sudo).
#   * Apache will be configured to run as the 'asterisk' user.
#   * Default FreePBX web URL: http://<server-ip>/
# ======================================================================

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (e.g., sudo bash $0)"; exit 1
fi

AST_VER="20"                       # Asterisk LTS major (auto-points to -current)
AST_TARBALL="asterisk-${AST_VER}-current.tar.gz"
FPBX_TARBALL="freepbx-17.0-latest.tgz"
BUILD_DIR="/usr/src"
AST_SRC_DIR="${BUILD_DIR}/asterisk-${AST_VER}*"
FPBX_DIR="${BUILD_DIR}/freepbx"
AST_USER="asterisk"
AST_GROUP="asterisk"
HOSTNAME_FQDN="${HOSTNAME:-pbx}.local"

echo "==> System update & base packages"
apt update
DEBIAN_FRONTEND=noninteractive apt -y upgrade

echo "==> Set hostname (can be changed later)"
hostnamectl set-hostname "${HOSTNAME_FQDN}"

echo "==> Core dependencies & build tools"
apt install -y \
  wget curl git ca-certificates gnupg2 dirmngr software-properties-common \
  build-essential subversion uuid uuid-dev libxml2-dev libsqlite3-dev \
  libjansson-dev libssl-dev libedit-dev libncurses5-dev unixodbc unixodbc-dev \
  libcurl4-openssl-dev libnewt-dev libsqlite3-dev libusb-1.0-0-dev \
  pkg-config sox fail2ban

echo "==> Add PHP 8.2 PPA (FreePBX 17 targets PHP 8.2)"
add-apt-repository -y ppa:ondrej/php
apt update

echo "==> Install Apache, MariaDB, PHP 8.2 + extensions"
apt install -y apache2 mariadb-server mariadb-client \
  php8.2 php8.2-cli php8.2-common php8.2-mysql php8.2-curl php8.2-gd \
  php8.2-mbstring php8.2-xml php8.2-bcmath php8.2-zip php8.2-intl php8.2-ldap \
  php-pear php-redis

echo "==> Enable Apache modules"
a2enmod rewrite headers expires
systemctl enable --now apache2

echo "==> Install Node.js 18 LTS (FreePBX build tooling uses Node)"
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

echo "==> Create 'asterisk' user/group and adjust permissions"
adduser --quiet --disabled-password --gecos "Asterisk User" ${AST_USER} || true
usermod -aG ${AST_GROUP} ${AST_USER}
usermod -aG ${AST_GROUP} www-data || true

echo "==> Configure Apache to run as 'asterisk' (recommended for FreePBX)"
sed -i 's/^export APACHE_RUN_USER=.*/export APACHE_RUN_USER=asterisk/' /etc/apache2/envvars
sed -i 's/^export APACHE_RUN_GROUP=.*/export APACHE_RUN_GROUP=asterisk/' /etc/apache2/envvars
systemctl restart apache2

echo "==> Secure MariaDB with sane defaults (local-only root via unix_socket)"
mysql -uroot <<'SQL'
-- Remove anonymous users and test db if present
DELETE FROM mysql.user WHERE User='';
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';
FLUSH PRIVILEGES;
SQL

echo "==> Prepare directories for Asterisk ownership"
for d in /etc/asterisk /var/lib/asterisk /var/log/asterisk /var/spool/asterisk /usr/lib/asterisk; do
  mkdir -p "$d"
  chown -R ${AST_USER}:${AST_GROUP} "$d"
done

echo "==> Fetch & build Asterisk ${AST_VER} (LTS)"
cd "${BUILD_DIR}"
wget -q "http://downloads.asterisk.org/pub/telephony/asterisk/${AST_TARBALL}"
tar xzf "${AST_TARBALL}"
cd ${AST_SRC_DIR}

echo "==> Install Asterisk prerequisites"
contrib/scripts/install_prereq install

echo "==> (Optional) Enable MP3 support for MOH"
contrib/scripts/get_mp3_source.sh || true

echo "==> Configure & build Asterisk"
./configure
# Enable format_mp3 if present
if [[ -f menuselect/menuselect ]]; then
  menuselect/menuselect --enable format_mp3 menuselect.makeopts || true
fi
make -j"$(nproc)"
make install
make samples
make config
ldconfig

echo "==> Make Asterisk run as '${AST_USER}'"
sed -i "s/^AST_USER=.*/AST_USER=${AST_USER}/" /etc/default/asterisk || true
sed -i "s/^AST_GROUP=.*/AST_GROUP=${AST_GROUP}/" /etc/default/asterisk || true
chown -R ${AST_USER}:${AST_GROUP} /etc/asterisk /var/*/asterisk /usr/lib/asterisk

systemctl enable --now asterisk

echo "==> Download FreePBX 17"
cd "${BUILD_DIR}"
wget -q "http://mirror.freepbx.org/modules/packages/freepbx/${FPBX_TARBALL}"
tar xzf "${FPBX_TARBALL}"
cd "${FPBX_DIR}"

echo "==> Start Asterisk for FreePBX install"
./start_asterisk start

echo "==> Install FreePBX (non-interactive)"
# Composer is bundled in FreePBX installer; ensure PHP 8.2 is used
/usr/bin/php8.2 ./install -n

echo "==> Fix ownership of web root"
chown -R ${AST_USER}:${AST_GROUP} /var/www/html

echo "==> Create a basic Apache vhost (DocumentRoot: /var/www/html)"
cat >/etc/apache2/sites-available/freepbx.conf <<'APACHE'
<VirtualHost *:80>
    ServerName _default_
    DocumentRoot /var/www/html
    <Directory "/var/www/html">
        AllowOverride All
        Require all granted
    </Directory>
    ErrorLog ${APACHE_LOG_DIR}/freepbx_error.log
    CustomLog ${APACHE_LOG_DIR}/freepbx_access.log combined
</VirtualHost>
APACHE
a2dissite 000-default.conf >/dev/null 2>&1 || true
a2ensite freepbx.conf
systemctl reload apache2

echo "==> (Optional) UFW firewall rules for HTTP(S), SIP & RTP"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow 5060/tcp || true
  ufw allow 5060/udp || true
  ufw allow 5061/tcp || true
  ufw allow 10000:20000/udp || true
fi

echo "==> Services status"
systemctl enable apache2 mariadb asterisk
systemctl restart apache2 asterisk

IP_ADDR=$(hostname -I | awk '{print $1}')
echo "============================================================================="
echo " FreePBX 17 + Asterisk ${AST_VER} is installed."
echo " Open:  http://${IP_ADDR}/"
echo " Complete the web-based setup (create admin user, activate, etc.)."
echo "============================================================================="
