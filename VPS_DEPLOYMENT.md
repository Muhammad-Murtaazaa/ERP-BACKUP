# Complete Linux VPS Deployment Guide (All-in-One: Frontend + Backend + Database)

Yes! You can deploy **everything** (React Frontend + Modular Monolith API + PostgreSQL Engine + Background Schedulers) onto a **single Linux VPS** (Ubuntu, Debian, CentOS, etc. on DigitalOcean, Hetzner, AWS EC2, Linode, Contabo, Vultr).

### Why a Linux VPS is great:
- 🚀 **Zero Sleep / Zero Cold Starts**: Runs 24/7/365 with instant responses.
- 💰 **Extremely Cheap**: Runs smoothly on a basic \$3–\$6/month VPS (1 vCPU, 1GB–2GB RAM).
- 🔒 **Full Control & Data Ownership**: Your database, audit trails, and logs stay 100% on your server.
- ⚡ **Zero CORS Issues**: Frontend & Backend run seamlessly behind an Nginx reverse proxy.

---

## 🛠️ Method 1: Automated 1-Click Script (Recommended & Fastest)

If you have a fresh Ubuntu (20.04/22.04/24.04) or Debian VPS:

### Step 1: Connect to your VPS via SSH
```bash
ssh root@YOUR_VPS_IP
```

### Step 2: Clone your repository
```bash
git clone https://github.com/YOUR_USER/YOUR_REPO.git /var/www/omnysync
cd /var/www/omnysync
```

### Step 3: Run the automated installer
```bash
chmod +x deploy-vps.sh
./deploy-vps.sh
```

**That's it!** The script will automatically:
1. Install Node.js 20 LTS, Nginx, PM2, and build tools.
2. Build all workspaces and frontend assets.
3. Start the ERP in high-performance cluster mode with PM2 and configure auto-start on server reboot.
4. Configure Nginx reverse proxy on port 80 and set up UFW firewall rules.
5. Provide your live web address!

---

## 🐳 Method 2: Docker Compose Deployment

If you prefer using Docker:

### Step 1: Install Docker & Docker Compose on your VPS
```bash
curl -fsSL https://get.docker.com | sh
```

### Step 2: Clone and Start
```bash
git clone https://github.com/YOUR_USER/YOUR_REPO.git /var/www/omnysync
cd /var/www/omnysync
docker compose up -d --build
```

Your ERP will be running on `http://YOUR_VPS_IP:4000` (or behind your host Nginx).

---

## 🔒 Free HTTPS / SSL Setup (Let's Encrypt)

If you connect a domain name (e.g. `erp.yourcompany.com`) pointing to your VPS IP:

1. Edit your Nginx configuration:
   ```bash
   sudo nano /etc/nginx/sites-available/omnysync
   ```
   Change `server_name _;` to:
   ```nginx
   server_name erp.yourcompany.com;
   ```
2. Reload Nginx:
   ```bash
   sudo systemctl reload nginx
   ```
3. Issue a free SSL certificate with Certbot:
   ```bash
   sudo certbot --nginx -d erp.yourcompany.com
   ```
Certbot will configure HTTPS automatically and renew the certificates for free in the background.

---

## 📊 Useful Management Commands (PM2)

| Task | Command |
|---|---|
| View Status | `pm2 status` |
| View Real-time Logs | `pm2 logs omnysync-erp` |
| Restart App | `pm2 restart omnysync-erp` |
| Stop App | `pm2 stop omnysync-erp` |
| Update Code & Redeploy | `git pull && npm run build && pm2 restart omnysync-erp` |
