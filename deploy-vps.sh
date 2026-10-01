#!/usr/bin/env bash
# ==============================================================================
# Omnysync ERP - Automated 1-Click Linux VPS Deployment Script
# Target OS: Ubuntu 22.04 / 24.04 LTS or Debian 11 / 12
# ==============================================================================

set -e

echo "=========================================================="
echo "🚀 Starting Omnysync ERP VPS Deployment"
echo "=========================================================="

# 1. Update system packages
echo "📦 Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y

# 2. Install Node.js 20.x LTS, Git, and build essentials if missing
if ! command -v node &> /dev/null; then
    echo "🟢 Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs git build-essential nginx ufw certbot python3-certbot-nginx
else
    echo "✅ Node.js is already installed ($(node -v))"
fi

# 3. Install PM2 globally
if ! command -v pm2 &> /dev/null; then
    echo "🟢 Installing PM2 process manager..."
    sudo npm install -g pm2
else
    echo "✅ PM2 is already installed"
fi

# 4. Install Project Dependencies & Build
echo "📦 Installing ERP project dependencies..."
npm install

echo "🔨 Building all workspaces (Contracts, Engine, Platform, UI, API, Web SPA)..."
npm run build

# 5. Configure PM2 process
echo "🚀 Launching Omnysync ERP via PM2..."
pm2 stop omnysync-erp 2>/dev/null || true
pm2 delete omnysync-erp 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup | tail -n 1 | bash 2>/dev/null || true

# 6. Configure Nginx Reverse Proxy
echo "🌐 Configuring Nginx reverse proxy on port 80..."
NGINX_CONF="/etc/nginx/sites-available/omnysync"

sudo tee $NGINX_CONF > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/omnysync /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 7. Configure Firewall
echo "🛡️ Configuring UFW firewall (Open SSH, HTTP, HTTPS)..."
sudo ufw allow 'Nginx Full' || true
sudo ufw allow ssh || true
sudo ufw --force enable || true

echo "=========================================================="
echo "🎉 DEPLOYMENT COMPLETE!"
echo "Your ERP is now live on your VPS IP: http://$(curl -s ifconfig.me)"
echo "PM2 Status: Run 'pm2 status' or 'pm2 logs' to monitor."
echo "=========================================================="
