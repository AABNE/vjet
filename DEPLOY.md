# vJetstar Pilot Hub — Oracle Linux VPS Deploy Guide

## Requirements
- Oracle Linux 8/9 (or RHEL-compatible), Oracle Cloud free tier A1 instance
- 2 GB RAM minimum, 20 GB disk
- Ports 80, 443, 3000 open in Oracle Cloud Security List

---

## 1. Install Node.js 22, PostgreSQL, nginx, PM2

```bash
# Node.js 22
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

# pnpm
npm install -g pnpm pm2

# PostgreSQL 15
sudo dnf install -y postgresql15-server postgresql15
sudo /usr/bin/postgresql-setup --initdb
sudo systemctl enable --now postgresql

# nginx
sudo dnf install -y nginx
sudo systemctl enable --now nginx

# Firewall
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

---

## 2. Set up PostgreSQL

```bash
sudo -u postgres psql << 'SQL'
CREATE USER jetstar WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE jetstar_hub OWNER jetstar;
GRANT ALL PRIVILEGES ON DATABASE jetstar_hub TO jetstar;
SQL
```

---

## 3. Upload and install the app

```bash
# From your machine:
scp uh-fixed-v9.zip opc@YOUR_VPS_IP:~

# On the VPS:
cd ~
unzip uh-fixed-v9.zip
mv uh-fixed /opt/jetstar-hub
cd /opt/jetstar-hub
pnpm install --ignore-scripts
```

---

## 4. Create environment file

```bash
cat > /opt/jetstar-hub/.env << 'ENV'
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://jetstar:CHANGE_THIS_PASSWORD@localhost:5432/jetstar_hub
SESSION_SECRET=GENERATE_WITH: openssl rand -hex 64
CORS_ORIGIN=https://YOUR_DOMAIN_OR_IP
ENV
```

Generate a real session secret:
```bash
openssl rand -hex 64
```

---

## 5. Build the project

```bash
cd /opt/jetstar-hub
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/flight-timetable run build
```

---

## 6. Start with PM2

```bash
cd /opt/jetstar-hub
pm2 start artifacts/api-server/dist/index.mjs \
  --name jetstar-hub \
  --env production \
  --node-args="--enable-source-maps" \
  -- --env-file /opt/jetstar-hub/.env

# Or use dotenv loading:
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command to enable autostart
```

---

## 7. ecosystem.config.cjs (PM2 config)

```js
module.exports = {
  apps: [{
    name: 'jetstar-hub',
    script: '/opt/jetstar-hub/artifacts/api-server/dist/index.mjs',
    interpreter: 'node',
    node_args: '--enable-source-maps',
    env: {
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: 'postgresql://jetstar:CHANGE_THIS_PASSWORD@localhost:5432/jetstar_hub',
      SESSION_SECRET: 'YOUR_SESSION_SECRET_HERE',
      CORS_ORIGIN: 'https://YOUR_DOMAIN_OR_IP',
    }
  }]
}
```

---

## 8. nginx reverse proxy

```bash
sudo nano /etc/nginx/conf.d/jetstar.conf
```

Paste:
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    client_max_body_size 10M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 9. HTTPS with Let's Encrypt (if you have a domain)

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
sudo systemctl enable --now certbot-renew.timer
```

---

## 10. Useful commands

```bash
pm2 logs jetstar-hub        # live logs
pm2 restart jetstar-hub     # restart
pm2 status                  # check status
sudo -u postgres psql jetstar_hub   # db shell
```

---

## Default login
- Username: `admin`
- Password: `admin1234`
- **Change this immediately in Admin → pilot management**

---

## SimLink Desktop App
Point it at `http://YOUR_VPS_IP` or `https://YOUR_DOMAIN` in Settings.
The app calls `/api/auth/login` and `/api/tracker/heartbeat`.
