# Deploying Omnysync ERP to Vercel + Supabase

Omnysync ERP is configured to run serverlessly on **Vercel** (serving both the Vite React SPA and the Express Modular Monolith API) backed by **Supabase PostgreSQL**.

---

## Architecture Overview

```
                      ┌───────────────────────────────────────┐
                      │              VERCEL                   │
                      │                                       │
                      │  ┌─────────────────────────────────┐  │
                      │  │  Vite React Frontend (Edge CDN) │  │
                      │  │  Routes: /*                     │  │
                      │  └─────────────────────────────────┘  │
                      │                 │                     │
                      │  ┌─────────────────────────────────┐  │
                      │  │  Serverless Function (/api)     │  │
                      │  │  Entrypoint: api/index.ts       │  │
                      │  │  Express Modular Monolith Engine│  │
                      │  └─────────────────────────────────┘  │
                      └──────────────────┬────────────────────┘
                                         │  Encrypted TLS / SSL
                                         ▼
                      ┌───────────────────────────────────────┐
                      │             SUPABASE                  │
                      │   PostgreSQL 16 Engine / Pooler       │
                      │   Port 6543 (Transaction Pooler)      │
                      │   Port 5432 (Session / Direct)        │
                      └───────────────────────────────────────┘
```

* **Same-Origin Hosting**: Both UI and `/api/*` run on your Vercel project domain (e.g. `https://my-erp.vercel.app`). **No CORS setup or external API URL needed**.
* **Auto-Migrations**: The serverless cold start checks and ensures all 47 SQL schema migrations are applied to your Supabase database.
* **Local Development**: When `DATABASE_URL` is omitted, the app automatically falls back to embedded `@electric-sql/pglite` (WebAssembly Postgres in Node) so you can still develop and test 100% offline.

---

## Step 1: Create Your Supabase Database

1. Sign in to [Supabase](https://supabase.com) and click **New project**.
2. Select an organization, name your project (e.g., `omnysync-erp`), set a strong database password, and pick a region close to your users.
3. Once the database is provisioned (approx. 1-2 minutes):
   * Go to **Project Settings** (gear icon) -> **Database**.
   * Under **Connection string**, select **URI**.
   * Choose **Mode: Transaction** (Port `6543`) — *Recommended for Serverless / Vercel*:
     ```
     postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
     ```
     *(Or select **Mode: Session** / Direct connection on port 5432).*

---

## Step 2 (Optional but Recommended): Pre-migrate & Seed from Local Machine

You can run the schema migrations and demo seed directly into your Supabase database using the Omnysync CLI tool:

### 1. Apply Schema Migrations
```bash
# In your terminal (PowerShell / Bash)
$env:DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"
npm run db:migrate
```

### 2. Seed Initial Demo Data (Accounts, Chart of Accounts, Items, Warehouses)
```bash
npm run db:seed
```

> **Note**: Even if you skip this step, the Vercel serverless function will automatically run missing migrations upon its initial invocation.

---

## Step 3: Deploy to Vercel

### Option A: Via Vercel Web Dashboard (Git Push)

1. Push your repository to GitHub / GitLab / Bitbucket.
2. Go to [Vercel Dashboard](https://vercel.com/new) and click **Add New... > Project**.
3. Import your repository.
4. Keep the default settings:
   * **Framework Preset**: Other (or Vite)
   * **Root Directory**: `./` (Leave as root)
   * **Build Command**: `npm run build`
   * **Output Directory**: `apps/web/dist` (auto-detected via `vercel.json`)
5. In **Environment Variables**, add:

| Key | Example Value | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://postgres.[REF]:[PASS]@[POOLER].pooler.supabase.com:6543/postgres` | Your Supabase connection URI |
| `OMNYSYNC_SESSION_SECRET` | *(Random 32+ char string)* | Used to sign session auth tokens |
| `OMNYSYNC_DEMO_SEED` | `true` (demo) or `false` (clean) | Pre-seeds demo data if true |
| `NODE_ENV` | `production` | Production mode |

6. Click **Deploy**.

---

### Option B: Via Vercel CLI

```bash
# Install Vercel CLI if not already installed
npm install -g vercel

# Deploy preview
vercel

# Add your environment variable
vercel env add DATABASE_URL

# Deploy to production
vercel --prod
```

---

## Step 4: Verification

1. Once deployment finishes, open your Vercel URL (e.g. `https://your-project.vercel.app`).
2. Test the API health endpoint:
   ```
   https://your-project.vercel.app/api/health
   ```
   You should receive a `200 OK` JSON response:
   ```json
   {
     "success": true,
     "data": {
       "status": "healthy",
       "service": "omnysync-erp-api",
       "environment": "production"
     }
   }
   ```
3. Sign in using the default root admin credentials (if demo seeded):
   * **Email**: `admin@omnysync.local`
   * **Password**: `Admin#12345`

---

## Helpful Commands

* **Run local development server (with offline PGlite)**:
  ```bash
  npm run dev
  ```
* **Test connection to Supabase locally**:
  ```bash
  $env:DATABASE_URL="<YOUR_SUPABASE_URI>"
  npm run db:migrate
  ```
* **Rebuild all monorepo packages**:
  ```bash
  npm run build
  ```
