import type { Express, Request, Response } from 'express';
import { SyntheticSeedRunner } from '@omnysync/platform';
import { Permission, ErrorCode } from '@omnysync/contracts';
import { db, authenticate, requirePermission, auditLogger } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError } from '../lib/errors.js';

export function registerAdminRoutes(app: Express): void {
  // ==========================================
  // 25. Admin & Seed Execution (demo/sandbox only)
  // ==========================================
  // Previously unauthenticated: anyone could trigger seeding. Now requires an
  // authenticated org administrator and is refused outside demo mode (AGENTS.md rule 11).
  app.post('/api/admin/seed', authenticate, requirePermission(Permission.ORG_MANAGE), async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === 'production' && process.env.OMNYSYNC_DEMO_MODE !== 'true') {
      throw new ApiError(403, ErrorCode.MODULE_NOT_READY, 'Synthetic seeding is only available in demo/sandbox installations');
    }
    const seeder = new SyntheticSeedRunner(db);
    const result = await seeder.runSeed();
    await auditLogger.record({
      organization_id: req.session!.organization_id,
      user_id: req.session!.user_id,
      action: 'DEMO_SEED_EXECUTED',
      entity_type: 'ORGANIZATION',
      entity_id: req.session!.organization_id,
      correlation_id: req.correlationId,
    });
    return ok(req, res, result);
  });
}
