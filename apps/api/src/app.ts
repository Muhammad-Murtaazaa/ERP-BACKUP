import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { errorHandler, wrapAsyncRoutes } from './lib/http.js';
import { getKeepAliveStatus, sendPing, resolveKeepAliveUrl } from './automation/keep-alive.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerFinanceRoutes } from './routes/finance.js';
import { registerMastersRoutes } from './routes/masters.js';
import { registerSalesRoutes } from './routes/sales.js';
import { registerProcurementRoutes } from './routes/procurement.js';
import { registerPaymentsRoutes } from './routes/payments.js';
import { registerTreasuryRoutes } from './routes/treasury.js';
import { registerHrmRoutes } from './routes/hrm.js';
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerManufacturingRoutes } from './routes/manufacturing.js';
import { registerProjectsRoutes } from './routes/projects.js';
import { registerAssetsRoutes } from './routes/assets.js';
import { registerPosRoutes } from './routes/pos.js';
import { registerAutomationRoutes } from './routes/automation.js';
import { registerQualityRoutes } from './routes/quality.js';
import { registerMaintenanceRoutes } from './routes/maintenance.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerTaxRoutes } from './routes/tax.js';
import { registerWmsRoutes } from './routes/wms.js';
import { registerAutomationEventRoutes } from './routes/automation-events.js';
import { registerServiceRoutes } from './routes/service.js';
import { registerCrmRoutes } from './routes/crm.js';
import { registerTimeRoutes } from './routes/time.js';
import { registerSupplierRoutes } from './routes/supplier.js';
import { registerLogisticsRoutes } from './routes/logistics.js';
import { registerBiRoutes } from './routes/bi.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerFleetRoutes } from './routes/fleet.js';
import { registerSubscriptionRoutes } from './routes/subscriptions.js';
import { registerBudgetRoutes } from './routes/budgets.js';
import { registerLendingRoutes } from './routes/lending.js';
import { registerGrcRoutes } from './routes/grc.js';
import { registerTalentRoutes } from './routes/talent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();
  wrapAsyncRoutes(app);

  app.disable('x-powered-by');

  // Correlation id (validated, never trusted blindly) & redacted request logging.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-correlation-id'];
    req.correlationId =
      typeof incoming === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    const start = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV === 'test') return;
      const duration = Date.now() - start;
      // Only method/path/status are logged; bodies (passwords, payroll, bank data) never are.
      console.log(`[${req.correlationId}] ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
    });
    next();
  });

  // Health check & ping endpoints for Render and keep-alive monitors
  app.get(['/health', '/ping'], (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      service: 'omnysync-erp',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      keepAlive: getKeepAliveStatus(),
    });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        status: 'healthy',
        service: 'omnysync-erp-api',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: '0.2.0',
        environment: process.env.NODE_ENV || 'development',
      },
    });
  });

  app.get('/api/keep-alive/status', (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: getKeepAliveStatus(),
    });
  });

  app.post('/api/keep-alive/ping', async (req: Request, res: Response) => {
    const targetUrl = resolveKeepAliveUrl();
    if (!targetUrl) {
      return res.status(400).json({
        success: false,
        error: { code: 'CONFIG_MISSING', message: 'No target URL configured for keep-alive ping' },
      });
    }
    const result = await sendPing(targetUrl);
    return res.status(result.success ? 200 : 502).json({
      success: result.success,
      data: result,
    });
  });

  // CORS: Configure OMNYSYNC_ALLOWED_ORIGINS as a comma-separated list or '*'
  const allowed = (process.env.OMNYSYNC_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.includes('*') || allowed.includes(origin)),
      exposedHeaders: ['x-correlation-id', 'idempotent-replay'],
    }),
  );
  // Document version uploads (DOC) carry base64 content up to 5 MB decoded; everything else stays at 1 MB.
  const smallJson = express.json({ limit: '1mb' });
  const uploadJson = express.json({ limit: '8mb' });
  app.use((req, res, next) => (/^\/api\/doc\/documents\/[^/]+\/versions$/.test(req.path) ? uploadJson(req, res, next) : smallJson(req, res, next)));

  // Baseline security headers.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  registerPlatformRoutes(app);
  registerFinanceRoutes(app);
  registerMastersRoutes(app);
  registerSalesRoutes(app);
  registerProcurementRoutes(app);
  registerPaymentsRoutes(app);
  registerTreasuryRoutes(app);
  registerHrmRoutes(app);
  registerInventoryRoutes(app);
  registerManufacturingRoutes(app);
  registerProjectsRoutes(app);
  registerAssetsRoutes(app);
  registerPosRoutes(app);
  registerAutomationRoutes(app);
  registerQualityRoutes(app);
  registerMaintenanceRoutes(app);
  registerAdminRoutes(app);
  registerConfigRoutes(app);
  registerTaxRoutes(app);
  registerWmsRoutes(app);
  registerAutomationEventRoutes(app);
  registerServiceRoutes(app);
  registerCrmRoutes(app);
  registerTimeRoutes(app);
  registerSupplierRoutes(app);
  registerLogisticsRoutes(app);
  registerBiRoutes(app);
  registerDocumentRoutes(app);
  registerFleetRoutes(app);
  registerSubscriptionRoutes(app);
  registerBudgetRoutes(app);
  registerLendingRoutes(app);
  registerGrcRoutes(app);
  registerTalentRoutes(app);

  // 404 handler for unknown API routes
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'RESOURCE_NOT_FOUND', message: `No route ${req.method} ${req.path}`, correlation_id: req.correlationId },
    });
  });

  // Resolve static web distribution directory for production single-service deployment
  const candidateWebPaths = [
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), 'dist/web'),
  ];
  const staticWebDir = candidateWebPaths.find((p) => fs.existsSync(p));

  if (staticWebDir) {
    console.log(`[Omnysync Web Host] Serving production frontend build from ${staticWebDir}`);
    app.use(express.static(staticWebDir));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) return next();
      const indexFile = path.join(staticWebDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        next();
      }
    });
  }

  app.use(errorHandler);
  return app;
}
