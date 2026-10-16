# vJetstar Pilot Hub — VPS Deployment Guide

## Server: Ubuntu 24.04 (Oracle Free Tier)

---

## First time setup (run once as root)

```bash
sudo bash deploy/setup-ubuntu.sh
```

This installs Node.js 22, PostgreSQL, PM2, nginx, and UFW firewall.
**Save the DATABASE_URL it prints** — you need it for your `.env`.

---

## Deploy the app

### 1. Upload the repo to your VPS

```bash
# From your local machine:
scp -r uh-fixed ubuntu@YOUR_VPS_IP:/opt/vjetstar
# OR clone from git:
git clone YOUR_REPO /opt/vjetstar
```

### 2. Create your .env file

```bash
cd /opt/vjetstar
cp deploy/.env.example .env
nano .env
```

Fill in:
- `SESSION_SECRET` — run `openssl rand -hex 32` to generate one
- `DATABASE_URL` — from the setup script output
- `PORT=3000`
- `NODE_ENV=production`

### 3. Build and start

```bash
bash deploy/deploy.sh
```

### 4. Configure nginx

```bash
sudo cp deploy/nginx-vjetstar.conf /etc/nginx/sites-available/vjetstar

# Edit the server_name line with your domain or IP:
sudo nano /etc/nginx/sites-available/vjetstar

sudo ln -s /etc/nginx/sites-available/vjetstar /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. (Optional) Free SSL with Let's Encrypt

```bash
sudo certbot --nginx -d pilots.yourdomain.com
```

---

## Running two apps on the same VPS

Your existing app keeps its nginx config untouched.
The Pilot Hub gets its own config file in `sites-available/vjetstar`.
nginx routes traffic by domain name:

```
yourdomain.com        →  your existing app (unchanged)
pilots.yourdomain.com →  vJetstar Pilot Hub (port 3000)
```

Both run at the same time. The Pilot Hub uses ~150MB RAM max.

---

## Useful commands

```bash
pm2 status                    # check if running
pm2 logs vjetstar-api         # live logs
pm2 restart vjetstar-api      # restart after config change
pm2 stop vjetstar-api         # stop

sudo nginx -t                 # test nginx config
sudo systemctl reload nginx   # reload nginx

sudo -u postgres psql         # PostgreSQL shell
\c vjetstar_hub               # connect to db
\dt                           # list tables
```

---

## Default login

- Username: `admin`
- Password: `admin1234`

**Change this immediately after first login via the Admin panel.**

---

## Update the app

```bash
cd /opt/vjetstar
git pull   # or re-upload files
bash deploy/deploy.sh
```

---

## SimLink desktop app

In the SimLink app Settings tab, set the Hub URL to:
- `http://YOUR_VPS_IP` (no domain)
- OR `https://pilots.yourdomain.com` (with domain + SSL)
