import crypto from 'node:crypto';
import { UserRole, Permission, AuthSession } from '@omnysync/contracts';
import { DbClient } from '../db/driver.js';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: [
    Permission.ORG_MANAGE,
    Permission.USER_MANAGE,
    Permission.FINANCE_COA_MANAGE,
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_PERIOD_MANAGE,
    Permission.FINANCE_JOURNAL_CREATE,
    Permission.FINANCE_JOURNAL_SUBMIT,
    Permission.FINANCE_JOURNAL_APPROVE,
    Permission.FINANCE_JOURNAL_POST,
    Permission.FINANCE_JOURNAL_REVERSE,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.PARTIES_MANAGE,
    Permission.ITEMS_MANAGE,
    Permission.INVENTORY_MANAGE,
    Permission.SALES_ORDER_MANAGE,
    Permission.PURCHASE_ORDER_MANAGE,
    Permission.AR_INVOICE_MANAGE,
    Permission.AP_INVOICE_MANAGE,
    Permission.PAYMENT_MANAGE,
    Permission.TREASURY_BANK_RECONCILE,
    Permission.TREASURY_FX_MANAGE,
    Permission.ONBOARDING_MANAGE,
    Permission.HRM_MANAGE,
    Permission.PAYROLL_MANAGE,
    Permission.PAYROLL_APPROVE,
    Permission.PAYROLL_POST,
    Permission.PAYROLL_DISBURSE,
    Permission.WAREHOUSE_MANAGE,
    Permission.INVENTORY_TRANSFER,
    Permission.INVENTORY_COUNT,
    Permission.INVENTORY_ADJUST,
    Permission.BOM_MANAGE,
    Permission.WORK_ORDER_MANAGE,
    Permission.WORK_ORDER_RELEASE,
    Permission.WORK_ORDER_CONSUME,
    Permission.WORK_ORDER_COMPLETE,
    Permission.PROJECT_MANAGE,
    Permission.BOQ_MANAGE,
    Permission.PROGRESS_CERTIFY,
    Permission.PROGRESS_INVOICE,
    Permission.ASSET_MANAGE,
    Permission.ASSET_DEPRECIATE,
    Permission.ASSET_DISPOSE,
    Permission.POS_TERMINAL,
    Permission.POS_REGISTER_MANAGE,
    Permission.POS_SESSION_CLOSE,
    Permission.QUALITY_PLAN_MANAGE,
    Permission.QUALITY_INSPECT,
    Permission.QUALITY_NCR_MANAGE,
    Permission.QUALITY_COA_MANAGE,
    Permission.EQUIPMENT_MANAGE,
    Permission.PM_SCHEDULE_MANAGE,
    Permission.MAINT_WORK_ORDER_MANAGE,
    Permission.CALIBRATION_MANAGE,
    Permission.AUTOMATION_VIEW,
    Permission.AUTOMATION_MANAGE,
    Permission.AUTOMATION_RUN,
    Permission.AUDIT_VIEW,
  ],
  [UserRole.CONTROLLER]: [
    Permission.FINANCE_COA_MANAGE,
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_PERIOD_MANAGE,
    Permission.FINANCE_JOURNAL_CREATE,
    Permission.FINANCE_JOURNAL_SUBMIT,
    Permission.FINANCE_JOURNAL_APPROVE,
    Permission.FINANCE_JOURNAL_POST,
    Permission.FINANCE_JOURNAL_REVERSE,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.PARTIES_MANAGE,
    Permission.ITEMS_MANAGE,
    Permission.INVENTORY_MANAGE,
    Permission.SALES_ORDER_MANAGE,
    Permission.PURCHASE_ORDER_MANAGE,
    Permission.AR_INVOICE_MANAGE,
    Permission.AP_INVOICE_MANAGE,
    Permission.PAYMENT_MANAGE,
    Permission.TREASURY_BANK_RECONCILE,
    Permission.TREASURY_FX_MANAGE,
    Permission.ONBOARDING_MANAGE,
    Permission.HRM_MANAGE,
    Permission.PAYROLL_MANAGE,
    Permission.PAYROLL_APPROVE,
    Permission.PAYROLL_POST,
    Permission.PAYROLL_DISBURSE,
    Permission.WAREHOUSE_MANAGE,
    Permission.INVENTORY_TRANSFER,
    Permission.INVENTORY_COUNT,
    Permission.INVENTORY_ADJUST,
    Permission.BOM_MANAGE,
    Permission.WORK_ORDER_MANAGE,
    Permission.WORK_ORDER_RELEASE,
    Permission.WORK_ORDER_CONSUME,
    Permission.WORK_ORDER_COMPLETE,
    Permission.PROJECT_MANAGE,
    Permission.BOQ_MANAGE,
    Permission.PROGRESS_CERTIFY,
    Permission.PROGRESS_INVOICE,
    Permission.ASSET_MANAGE,
    Permission.ASSET_DEPRECIATE,
    Permission.ASSET_DISPOSE,
    Permission.POS_TERMINAL,
    Permission.POS_REGISTER_MANAGE,
    Permission.POS_SESSION_CLOSE,
    Permission.QUALITY_PLAN_MANAGE,
    Permission.QUALITY_INSPECT,
    Permission.QUALITY_NCR_MANAGE,
    Permission.QUALITY_COA_MANAGE,
    Permission.EQUIPMENT_MANAGE,
    Permission.PM_SCHEDULE_MANAGE,
    Permission.MAINT_WORK_ORDER_MANAGE,
    Permission.CALIBRATION_MANAGE,
    Permission.AUTOMATION_VIEW,
    Permission.AUTOMATION_MANAGE,
    Permission.AUTOMATION_RUN,
    Permission.AUDIT_VIEW,
  ],
  [UserRole.HR_MANAGER]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.HRM_MANAGE,
    Permission.PAYROLL_MANAGE,
    Permission.PAYROLL_APPROVE,
  ],
  [UserRole.ACCOUNTANT]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_JOURNAL_CREATE,
    Permission.FINANCE_JOURNAL_SUBMIT,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.PARTIES_MANAGE,
    Permission.ITEMS_MANAGE,
    Permission.AR_INVOICE_MANAGE,
    Permission.AP_INVOICE_MANAGE,
    Permission.PAYMENT_MANAGE,
    Permission.TREASURY_BANK_RECONCILE,
    Permission.PAYROLL_MANAGE,
    Permission.PROGRESS_INVOICE,
    Permission.ASSET_MANAGE,
    Permission.ASSET_DEPRECIATE,
    Permission.ASSET_DISPOSE,
    Permission.QUALITY_NCR_MANAGE,
    Permission.MAINT_WORK_ORDER_MANAGE,
  ],
  [UserRole.SALES_OPERATOR]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.PARTIES_MANAGE,
    Permission.ITEMS_MANAGE,
    Permission.SALES_ORDER_MANAGE,
    Permission.AR_INVOICE_MANAGE,
    Permission.POS_TERMINAL,
    Permission.QUALITY_COA_MANAGE,
  ],
  [UserRole.INVENTORY_MANAGER]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.ITEMS_MANAGE,
    Permission.INVENTORY_MANAGE,
    Permission.PURCHASE_ORDER_MANAGE,
    Permission.WAREHOUSE_MANAGE,
    Permission.INVENTORY_TRANSFER,
    Permission.INVENTORY_COUNT,
    Permission.INVENTORY_ADJUST,
    Permission.QUALITY_INSPECT,
  ],
  [UserRole.PRODUCTION_MANAGER]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.ITEMS_MANAGE,
    Permission.INVENTORY_MANAGE,
    Permission.BOM_MANAGE,
    Permission.WORK_ORDER_MANAGE,
    Permission.WORK_ORDER_RELEASE,
    Permission.WORK_ORDER_CONSUME,
    Permission.WORK_ORDER_COMPLETE,
    Permission.QUALITY_INSPECT,
    Permission.EQUIPMENT_MANAGE,
    Permission.MAINT_WORK_ORDER_MANAGE,
  ],
  [UserRole.WAREHOUSE_OPERATOR]: [
    Permission.INVENTORY_MANAGE,
    Permission.WAREHOUSE_MANAGE,
    Permission.INVENTORY_TRANSFER,
    Permission.INVENTORY_COUNT,
  ],
  [UserRole.PROJECT_MANAGER]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.ITEMS_MANAGE,
    Permission.PARTIES_MANAGE,
    Permission.PROJECT_MANAGE,
    Permission.BOQ_MANAGE,
    Permission.PROGRESS_CERTIFY,
  ],
  [UserRole.QUALITY_MANAGER]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.ITEMS_MANAGE,
    Permission.QUALITY_PLAN_MANAGE,
    Permission.QUALITY_INSPECT,
    Permission.QUALITY_NCR_MANAGE,
    Permission.QUALITY_COA_MANAGE,
  ],
  [UserRole.MAINTENANCE_ENGINEER]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.ITEMS_MANAGE,
    Permission.EQUIPMENT_MANAGE,
    Permission.PM_SCHEDULE_MANAGE,
    Permission.MAINT_WORK_ORDER_MANAGE,
    Permission.CALIBRATION_MANAGE,
  ],
  // Cashiers previously held ITEMS_MANAGE, letting a till operator change master
  // prices; price changes at the till now require a manager PIN approval instead.
  [UserRole.CASHIER]: [
    Permission.POS_TERMINAL,
    Permission.POS_SESSION_CLOSE,
  ],
  [UserRole.STORE_MANAGER]: [
    Permission.POS_TERMINAL,
    Permission.POS_SESSION_CLOSE,
    Permission.POS_REGISTER_MANAGE,
    Permission.PARTIES_MANAGE,
    Permission.FINANCE_REPORTS_VIEW,
  ],
  [UserRole.AUDITOR]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.AUTOMATION_VIEW,
    Permission.AUDIT_VIEW,
  ],
  [UserRole.VIEWER]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
  ],
};

/** Default session lifetime: 8 hours. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const DEV_ONLY_SECRET = 'omnysync-dev-only-session-secret-change-me-0001';

/**
 * Resolves the HMAC session secret. Production refuses to start without an explicit
 * secret of at least 32 characters (SECURITY.md: no fixed shared secrets).
 */
export function resolveSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OMNYSYNC_SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (env.NODE_ENV === 'production') {
    throw new Error('OMNYSYNC_SESSION_SECRET (>= 32 chars) must be configured in production');
  }
  return DEV_ONLY_SECRET;
}

export class AuthService {
  private db: DbClient;
  private secret: string;
  private ttlSeconds: number;

  constructor(db: DbClient, secret: string = resolveSessionSecret(), ttlSeconds: number = SESSION_TTL_SECONDS) {
    if (!secret || secret.length < 32) {
      throw new Error('Session secret must be at least 32 characters');
    }
    this.db = db;
    this.secret = secret;
    this.ttlSeconds = ttlSeconds;
  }

  get database(): DbClient {
    return this.db;
  }

  static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  static verifyPassword(password: string, combinedHash: string): boolean {
    const [salt, hash] = String(combinedHash || '').split(':');
    if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash) || hash.length !== 128) return false;
    const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  }

  /**
   * Burns comparable CPU time when a login email is unknown so response timing does
   * not reveal which accounts exist.
   */
  static dummyVerify(password: string): void {
    crypto.scryptSync(password, '00000000000000000000000000000000', 64);
  }

  /**
   * Generates a signed tamper-proof session token with issued-at and expiry claims.
   */
  generateSessionToken(session: AuthSession, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
    const claims: AuthSession = { ...session, iat: nowSeconds, exp: nowSeconds + this.ttlSeconds };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  /**
   * Verifies signature and expiry and extracts the session payload from a token.
   */
  verifySessionToken(token: string, nowSeconds: number = Math.floor(Date.now() / 1000)): AuthSession | null {
    try {
      if (typeof token !== 'string' || token.length > 8192) return null;
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [payload, signature] = parts;
      if (!payload || !signature) return null;

      const expectedSig = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
      const a = Buffer.from(signature);
      const b = Buffer.from(expectedSig);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return null;
      }

      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as AuthSession;
      if (typeof decoded.exp !== 'number' || decoded.exp <= nowSeconds) return null;
      if (!decoded.user_id || !decoded.organization_id) return null;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Resolves complete permissions for a user from their roles. Unknown role names
   * grant nothing (deny by default).
   */
  static resolvePermissions(roles: UserRole[]): string[] {
    const perms = new Set<string>();
    for (const role of roles || []) {
      const rolePerms = Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role) ? ROLE_PERMISSIONS[role] : [];
      for (const p of rolePerms) {
        perms.add(p);
      }
    }
    return Array.from(perms);
  }

  /**
   * Checks if session has required permission.
   */
  static hasPermission(session: AuthSession, permission: Permission): boolean {
    return Array.isArray(session.permissions) && session.permissions.includes(permission);
  }
}
