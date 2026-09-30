import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { errorHandler, wrapAsyncRoutes } from './lib/http.js';
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

  // Narrow CORS (SECURITY.md). Configure OMNYSYNC_ALLOWED_ORIGINS as a comma list.
  const allowed = (process.env.OMNYSYNC_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
      exposedHeaders: ['x-correlation-id', 'idempotent-replay'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

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

  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'RESOURCE_NOT_FOUND', message: `No route ${req.method} ${req.path}`, correlation_id: req.correlationId },
    });
  });
  app.use(errorHandler);
  return app;
}
