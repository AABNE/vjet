#!/bin/bash
# vJetstar Pilot Hub — Oracle Linux VPS setup script
# Tested on Oracle Linux 8/9 (RHEL-compatible)
# Run as root: bash setup-vps.sh

set -e
echo "======================================================"
echo "  vJetstar Pilot Hub — VPS Setup"
echo "======================================================"

# 1. System packages
dnf update -y
dnf install -y curl git unzip firewalld nginx postgresql postgresql-server postgresql-contrib

# 2. Node.js 22 via NodeSource
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs
npm install -g pnpm pm2

# 3. PostgreSQL setup
postgresql-setup --initdb
systemctl enable postgresql --now

# Wait for pg to start
sleep 3

# Create DB and user
sudo -u postgres psql << 'PSQL'
CREATE USER vjetstar WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE vjetstar_hub OWNER vjetstar;
GRANT ALL PRIVILEGES ON DATABASE vjetstar_hub TO vjetstar;
PSQL

echo "PostgreSQL ready. DB: vjetstar_hub / User: vjetstar"

# 4. Firewall — open ports 80, 443, 22
systemctl enable firewalld --now
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --add-service=ssh
firewall-cmd --reload

# 5. App directory
mkdir -p /opt/vjetstar
chown $SUDO_USER:$SUDO_USER /opt/vjetstar 2>/dev/null || true

echo ""
echo "======================================================"
echo "  Setup complete. Next steps:"
echo "  1. Upload your app to /opt/vjetstar"
echo "  2. cd /opt/vjetstar && cp deploy/.env.example .env"
echo "  3. Edit .env with your values"
echo "  4. pnpm install"
echo "  5. pm2 start deploy/ecosystem.config.cjs"
echo "  6. Copy deploy/nginx.conf to /etc/nginx/conf.d/vjetstar.conf"
echo "  7. systemctl restart nginx"
echo "  8. (Optional) certbot --nginx -d your-domain.com"
echo "======================================================"
