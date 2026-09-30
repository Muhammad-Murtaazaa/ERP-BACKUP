import type { Express, Request, Response } from 'express';
import { AuthService } from '@omnysync/platform';
import { ErrorCode, Permission, UserRole, AuthSession } from '@omnysync/contracts';
import { db, authService, auditLogger, authenticate, requirePermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError } from '../lib/errors.js';
import { pagination, optionalStr } from '../lib/validate.js';

/**
 * In-memory login throttle keyed by email and client address: 10 failures within
 * 15 minutes locks further attempts for the remainder of the window (SECURITY.md
 * rate limiting). Successful login clears the counter.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map<string, { count: number; first: number }>();

export function resetLoginThrottle() {
  loginFailures.clear();
}

function throttleKey(req: Request, email: string) {
  let addr = 'local';
  try {
    addr = req.ip || req.socket?.remoteAddress || 'local';
  } catch {
    // Non-socket transports (in-process test harness) have no peer address.
  }
  return `${email}|${addr}`;
}

function isThrottled(key: string, now = Date.now()) {
  const rec = loginFailures.get(key);
  if (!rec) return false;
  if (now - rec.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return rec.count >= LOGIN_MAX_FAILURES;
}

function recordFailure(key: string, now = Date.now()) {
  const rec = loginFailures.get(key);
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) loginFailures.set(key, { count: 1, first: now });
  else rec.count += 1;
}

export function registerPlatformRoutes(app: Express): void {
  // ==========================================
  // 1. Auth Routes
  // ==========================================
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      throw new ApiError(400, ErrorCode.VALIDATION_FAILED, 'Email and password are required');
    }
    if (email.length > 255 || password.length > 1024) {
      throw new ApiError(400, ErrorCode.VALIDATION_FAILED, 'Email or password too long');
    }
    const normalizedEmail = email.toLowerCase().trim();
    const key = throttleKey(req, normalizedEmail);
    if (isThrottled(key)) {
      throw new ApiError(429, ErrorCode.RATE_LIMITED, 'Too many failed sign-in attempts. Try again later.');
    }

    const userQuery = await db.query(
      `SELECT u.id, u.email, u.name, u.password_hash, m.organization_id, m.legal_entity_id, m.roles
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       WHERE u.email = $1 AND u.is_active = true AND m.is_active = true
       ORDER BY m.created_at ASC`,
      [normalizedEmail],
    );

    const userRow = userQuery.rows[0];
    const valid = userRow ? AuthService.verifyPassword(password, userRow.password_hash) : (AuthService.dummyVerify(password), false);
    if (!valid) {
      recordFailure(key);
      throw new ApiError(401, ErrorCode.UNAUTHENTICATED, 'Invalid email or credentials');
    }
    loginFailures.delete(key);

    const roles = (typeof userRow.roles === 'string' ? JSON.parse(userRow.roles) : userRow.roles) as UserRole[];
    const session: AuthSession = {
      user_id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      organization_id: userRow.organization_id,
      legal_entity_id: userRow.legal_entity_id,
      roles,
      permissions: AuthService.resolvePermissions(roles),
    };
    const token = authService.generateSessionToken(session);
    const claims = authService.verifySessionToken(token);

    await auditLogger.record({
      organization_id: session.organization_id,
      user_id: session.user_id,
      action: 'USER_SIGNED_IN',
      entity_type: 'USER',
      entity_id: session.user_id,
      correlation_id: req.correlationId,
    });

    return ok(req, res, { token, user: session, expires_at: claims?.exp ? new Date(claims.exp * 1000).toISOString() : null });
  });

  app.get('/api/auth/me', authenticate, (req: Request, res: Response) => {
    return ok(req, res, req.session);
  });

  // ==========================================
  // 2. Organization & Master Data
  // ==========================================
  app.get('/api/orgs/context', authenticate, async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const orgRes = await db.query('SELECT id, name, code, is_active FROM organizations WHERE id = $1', [org]);
    const leRes = await db.query(
      'SELECT id, name, code, functional_currency, tax_identifier, is_active FROM legal_entities WHERE organization_id = $1',
      [org],
    );
    const branchRes = await db.query('SELECT id, name, code, legal_entity_id, is_active FROM branches WHERE organization_id = $1', [org]);
    return ok(req, res, {
      organization: orgRes.rows[0] || null,
      legalEntities: leRes.rows,
      branches: branchRes.rows,
      environment: {
        demo_mode: process.env.NODE_ENV !== 'production' || process.env.OMNYSYNC_DEMO_MODE === 'true',
        version: '0.2.0',
      },
    });
  });

  // ==========================================
  // 7. Audit Log Inspector (filterable, paginated)
  // ==========================================
  app.get('/api/audit/logs', authenticate, requirePermission(Permission.AUDIT_VIEW), async (req: Request, res: Response) => {
    const { limit, offset } = pagination(req.query as Record<string, unknown>, { limit: 100, max: 500 });
    const entityType = optionalStr(req.query.entity_type, 'entity_type', 100);
    const action = optionalStr(req.query.action, 'action', 100);
    const search = optionalStr(req.query.search, 'search', 100);
    const params: unknown[] = [req.session!.organization_id];
    let where = 'a.organization_id = $1';
    if (entityType) {
      params.push(entityType);
      where += ` AND a.entity_type = $${params.length}`;
    }
    if (action) {
      params.push(action);
      where += ` AND a.action = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (a.action ILIKE $${params.length} OR a.entity_type ILIKE $${params.length} OR a.entity_id::text ILIKE $${params.length})`;
    }
    const countRes = await db.query(`SELECT COUNT(*)::int AS n FROM audit_logs a WHERE ${where}`, params);
    params.push(limit, offset);
    const logs = await db.query(
      `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where} ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return ok(req, res, logs.rows, 200, { total_count: countRes.rows[0].n, limit, offset });
  });

}
