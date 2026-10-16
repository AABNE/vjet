#!/bin/bash
# vJetstar Pilot Hub — Ubuntu 24.04 Setup
# Run once as root on a fresh Ubuntu 24.04 Oracle VPS
# Usage: sudo bash setup-ubuntu.sh
set -e

GREEN='\033[0;32m'; ORANGE='\033[0;33m'; NC='\033[0m'
info()  { echo -e "${ORANGE}[vJetstar]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }

info "Starting vJetstar Pilot Hub setup on Ubuntu 24.04..."

# ── System ───────────────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git unzip nginx postgresql postgresql-contrib \
                   certbot python3-certbot-nginx ufw build-essential

# ── Node.js 22 ───────────────────────────────────────────────────────────
info "Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
npm install -g pnpm pm2
pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | bash || true
ok "Node.js $(node -v) + pnpm + PM2 installed"

# ── PostgreSQL ───────────────────────────────────────────────────────────
info "Configuring PostgreSQL..."
systemctl enable postgresql --now
sleep 2

# Create DB user + database
DB_PASS=$(openssl rand -hex 20)
sudo -u postgres psql -c "CREATE USER vjetstar WITH PASSWORD '${DB_PASS}';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE vjetstar_hub OWNER vjetstar;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE vjetstar_hub TO vjetstar;" 2>/dev/null || true

ok "PostgreSQL ready"
echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  DATABASE_URL=postgresql://vjetstar:${DB_PASS}@localhost:5432/vjetstar_hub"
echo "  │  SAVE THIS — you need it in your .env file  │"
echo "  └─────────────────────────────────────────────┘"
echo ""

# ── Firewall (UFW) ───────────────────────────────────────────────────────
info "Configuring firewall..."
ufw --force enable
ufw allow ssh
ufw allow 'Nginx Full'
ok "Firewall configured (SSH + HTTP + HTTPS open)"

# ── Log directory ────────────────────────────────────────────────────────
mkdir -p /var/log/vjetstar
chown ubuntu:ubuntu /var/log/vjetstar

# ── App directory ────────────────────────────────────────────────────────
mkdir -p /opt/vjetstar
chown ubuntu:ubuntu /opt/vjetstar

echo ""
ok "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Upload repo to /opt/vjetstar (scp, git clone, etc.)"
echo "  2. cd /opt/vjetstar"
echo "  3. cp deploy/.env.example .env && nano .env   (fill in DB_URL + secrets)"
echo "  4. bash deploy/deploy.sh"
echo "  5. sudo cp deploy/nginx-vjetstar.conf /etc/nginx/sites-available/vjetstar"
echo "  6. sudo ln -s /etc/nginx/sites-available/vjetstar /etc/nginx/sites-enabled/"
echo "  7. sudo nginx -t && sudo systemctl reload nginx"
echo "  8. (Optional SSL) sudo certbot --nginx -d YOUR_DOMAIN"
echo ""
