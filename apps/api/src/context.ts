import type { Request, Response, NextFunction } from 'express';
import { PGliteAdapter, PgPoolAdapter, AuthService, AuditLogger, OutboxService, DbClient } from '@omnysync/platform';
import { ErrorCode, StandardErrorResponse, AuthSession, Permission, UserRole } from '@omnysync/contracts';
import { idempotency } from './lib/idempotency.js';

/**
 * Process-wide singletons shared by route modules. Automatically switches to
 * PgPoolAdapter if DATABASE_URL or POSTGRES_URL is configured, or uses on-disk
 * PGlite engine to stay well below memory limits.
 */
export const db: DbClient = process.env.DATABASE_URL || process.env.POSTGRES_URL
  ? new PgPoolAdapter(process.env.DATABASE_URL || process.env.POSTGRES_URL!)
  : new PGliteAdapter(
      process.env.PGDATA_DIR ||
      (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? '/tmp/omnysync.db' : (process.env.NODE_ENV === 'test' ? undefined : './data/omnysync.db'))
    );
export const authService = new AuthService(db);
export const auditLogger = new AuditLogger(db);
export const outboxService = new OutboxService(db);
const idempotencyGuard = idempotency(db);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
      session?: AuthSession;
    }
  }
}

function deny(req: Request, res: Response, status: number, code: ErrorCode, message: string) {
  return res.status(status).json({
    success: false,
    error: { code, message, correlation_id: req.correlationId },
  } satisfies StandardErrorResponse);
}

/**
 * Authenticates the bearer token and then re-resolves membership and roles from the
 * database on every request (logic.md step 1: organization from trusted membership).
 * Revoked/deactivated users or memberships lose access immediately rather than at
 * token expiry, and permissions always reflect current role grants.
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return deny(req, res, 401, ErrorCode.UNAUTHENTICATED, 'Missing or invalid Bearer authentication token');
    }
    const token = authHeader.substring(7);
    const claims = authService.verifySessionToken(token);
    if (!claims) {
      return deny(req, res, 401, ErrorCode.UNAUTHENTICATED, 'Invalid or expired session token');
    }

    const membership = await db.query<{ roles: unknown; legal_entity_id: string; name: string; email: string }>(
      `SELECT m.roles, m.legal_entity_id, u.name, u.email
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.user_id = $1 AND m.organization_id = $2 AND m.is_active = true AND u.is_active = true`,
      [claims.user_id, claims.organization_id],
    );
    if (membership.rows.length === 0) {
      return deny(req, res, 401, ErrorCode.UNAUTHENTICATED, 'Membership is no longer active');
    }
    const row = membership.rows[0];
    const roles = (typeof row.roles === 'string' ? JSON.parse(row.roles) : row.roles) as UserRole[];
    req.session = {
      ...claims,
      name: row.name,
      email: row.email,
      legal_entity_id: row.legal_entity_id || claims.legal_entity_id,
      roles,
      permissions: AuthService.resolvePermissions(roles),
    };
    return idempotencyGuard(req, res, next);
  } catch (err) {
    next(err);
  }
};

export const requirePermission = (permission: Permission) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      return deny(req, res, 401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    if (!AuthService.hasPermission(req.session, permission)) {
      return deny(req, res, 403, ErrorCode.UNAUTHORIZED, `Forbidden: Missing required permission "${permission}"`);
    }
    next();
  };
};

/** Passes when the session holds any one of the listed permissions. */
export const requireAnyPermission = (...permissions: Permission[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      return deny(req, res, 401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    if (!permissions.some((p) => AuthService.hasPermission(req.session!, p))) {
      return deny(req, res, 403, ErrorCode.UNAUTHORIZED, `Forbidden: requires one of ${permissions.join(', ')}`);
    }
    next();
  };
};
