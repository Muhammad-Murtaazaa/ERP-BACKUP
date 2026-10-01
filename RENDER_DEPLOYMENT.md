# Deploying Omnysync ERP to Render (With Anti-Sleep Keep-Alive)

This guide walks you through deploying the complete Omnysync ERP platform (Web Frontend + Backend API + Database + Keep-Alive Engine) to [Render](https://render.com) so it runs continuously and **never sleeps on Render's free tier**.

---

## ⚡ Quick Summary of What Was Configured

1. **Unified Single Web Service**:
   - The production Express server automatically hosts the high-performance React Web SPA from `apps/web/dist` alongside all backend `/api/...` endpoints.
   - You only need **1 free Web Service on Render** with **0 CORS issues**.

2. **Built-in Anti-Sleep Keep-Alive Engine**:
   - Render free-tier web services normally go to sleep after 15 minutes of inactivity.
   - Our built-in background keep-alive worker automatically detects your public Render URL (`RENDER_EXTERNAL_URL`) and dispatches a lightweight keep-alive request to `/health` every **10 minutes**, keeping the container active 24/7.
   - You can also monitor status at `/api/keep-alive/status` or trigger a manual test ping via `POST /api/keep-alive/ping`.

3. **Render Blueprint (`render.yaml`)**:
   - Ready for 1-click Blueprints deployment.

4. **Fail-safe GitHub Actions Workflow (`.github/workflows/keep-alive.yml`)**:
   - Optional external pinger that runs on GitHub's cron every 10 minutes to guarantee uptime.

---

## 🚀 Step-by-Step Deployment Instructions

### Method 1: Deploy via Render Blueprint (Recommended - 1 Click)

1. **Push your code to GitHub / GitLab**.
2. Log in to [dashboard.render.com](https://dashboard.render.com).
3. Click **"New +"** in the top right and select **"Blueprint"**.
4. Connect your repository (`ERP-BACKUP` or your repository name).
5. Render will automatically detect [`render.yaml`](file:///d:/Enterprise%20Resource%20Planning/render.yaml) and configure:
   - **Service Type**: Web Service (`node`)
   - **Plan**: `Free`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`
   - **Health Check Path**: `/health`
   - **Environment Variables**: pre-configured (`NODE_ENV=production`, `PORT=10000`, `KEEP_ALIVE_ENABLED=true`, `KEEP_ALIVE_INTERVAL_MINUTES=10`)
6. Click **"Apply"** / **"Create Blueprint Instance"**.
7. Wait 2–3 minutes for the build to complete. Once deployed, Render will provide your public URL (e.g., `https://omnysync-erp.onrender.com`).

---

### Method 2: Manual Web Service Setup on Render

If you prefer setting up manually without Blueprints:

1. Go to [dashboard.render.com](https://dashboard.render.com).
2. Click **"New +"** $\rightarrow$ **"Web Service"**.
3. Select **"Build and deploy from a Git repository"** and connect your repository.
4. Fill in the following settings:
   - **Name**: `omnysync-erp` (or your choice)
   - **Region**: Any (e.g. `Oregon (US West)` or `Frankfurt (EU)`)
   - **Branch**: `main` (or `master`)
   - **Root Directory**: *(Leave empty)*
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`
   - **Instance Type**: `Free`
5. Click **"Advanced"**:
   - **Health Check Path**: `/health`
   - **Add Environment Variables**:
     | Key | Value | Description |
     |---|---|---|
     | `NODE_ENV` | `production` | Production mode |
     | `PORT` | `10000` | Render default port |
     | `KEEP_ALIVE_ENABLED` | `true` | Enables auto-pinger |
     | `KEEP_ALIVE_INTERVAL_MINUTES` | `10` | Pings every 10 min |
     | `OMNYSYNC_DEMO_SEED` | `true` | Seeds initial ERP users & demo dataset |
6. Click **"Create Web Service"**.

---

## 🛡️ How the Anti-Sleep Keep-Alive Works

```
┌────────────────────────────────────────────────────────┐
│                      Render Cloud                      │
│                                                        │
│   ┌────────────────────────────────────────────────┐   │
│   │           Omnysync ERP Web Service             │   │
│   │                                                │   │
│   │  ┌──────────────┐      Every 10 mins           │   │
│   │  │  Keep-Alive  ├──────────────────────┐       │   │
│   │  │   Scheduler  │                      ▼       │   │
│   │  └──────────────┘           Outbound HTTPS     │   │
│   │                                    │           │   │
│   │  ┌──────────────┐                  │           │   │
│   │  │  /health API │ ◄────────────────┘           │   │
│   │  └──────────────┘    (Inbound Webhook hits     │   │
│   │                       Render Proxy -> Awake)   │   │
│   └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

- Render sets `RENDER_EXTERNAL_URL` automatically on all web services (e.g. `https://your-app.onrender.com`).
- The internal engine automatically grabs this URL, and every 10 minutes (before the 15-minute inactivity timeout), it sends an HTTPS GET request to `https://your-app.onrender.com/health`.
- This creates incoming web traffic on the Render proxy, keeping the free container permanently awake!

### Custom Domain Keep-Alive (Optional)
If you add a custom domain (e.g., `erp.yourcompany.com`) on Render:
- Add an environment variable in Render Settings:
  - `KEEP_ALIVE_URL` = `https://erp.yourcompany.com`

---

## 🔍 Verification & Health Checking

Once your app is deployed, you can verify it in your browser:

1. **Frontend UI**: Visit `https://your-app.onrender.com`
2. **Health Check**: Visit `https://your-app.onrender.com/health`
   - Expected JSON output:
     ```json
     {
       "status": "healthy",
       "service": "omnysync-erp",
       "uptime": 120.4,
       "timestamp": "2026-10-01T16:50:00.000Z",
       "keepAlive": {
         "enabled": true,
         "targetUrl": "https://your-app.onrender.com/health",
         "intervalMinutes": 10,
         "pingCount": 1,
         "lastPingStatus": "SUCCESS"
       }
     }
     ```
3. **Keep-Alive Status**: Visit `https://your-app.onrender.com/api/keep-alive/status`

---

## 🌐 Optional: External Fail-safe Pinger (100% Free)

If you'd like a secondary external pinger in addition to the built-in keep-alive:

### Option A: Free UptimeRobot / Cron-Job.org
1. Create a free account on [UptimeRobot.com](https://uptimerobot.com) or [cron-job.org](https://cron-job.org).
2. Add a new monitor:
   - **Type**: `HTTP(s)`
   - **URL**: `https://your-app.onrender.com/health`
   - **Monitoring Interval**: `5 minutes` or `10 minutes`

### Option B: GitHub Actions Cron (Pre-configured)
The file `.github/workflows/keep-alive.yml` is already included in this repository.
1. In your GitHub repo, go to **Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions**.
2. Add a repository secret named `RENDER_APP_URL` with your Render URL: `https://your-app.onrender.com`.
3. GitHub Actions will automatically ping your app every 10 minutes for free!
