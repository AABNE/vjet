#!/bin/bash
# vJetstar Pilot Hub — build + restart
# Run from repo root: bash deploy/deploy.sh
set -e

GREEN='\033[0;32m'; ORANGE='\033[0;33m'; NC='\033[0m'
info() { echo -e "${ORANGE}[vJetstar]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }

# Must be run from repo root
cd "$(dirname "$0")/.."

# Check .env exists
if [ ! -f .env ]; then
    echo "ERROR: .env file not found in repo root."
    echo "Run: cp deploy/.env.example .env && nano .env"
    exit 1
fi

info "Installing dependencies..."
pnpm install --ignore-scripts

info "Building API server..."
pnpm --filter @workspace/api-server run build

info "Building frontend..."
pnpm --filter @workspace/flight-timetable run build

info "Starting/restarting with PM2..."
# Load .env for PM2
export $(grep -v '^#' .env | xargs)

if pm2 list | grep -q "vjetstar-api"; then
    pm2 restart vjetstar-api --update-env
    ok "Restarted vjetstar-api"
else
    pm2 start deploy/ecosystem.config.cjs
    ok "Started vjetstar-api"
fi

pm2 save
ok "=== Deploy complete ==="
echo ""
pm2 status
