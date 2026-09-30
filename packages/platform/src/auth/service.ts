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
    Permission.AUDIT_VIEW,
  ],
  [UserRole.ACCOUNTANT]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_JOURNAL_CREATE,
    Permission.FINANCE_JOURNAL_SUBMIT,
    Permission.FINANCE_REPORTS_VIEW,
  ],
  [UserRole.SALES_OPERATOR]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
  ],
  [UserRole.INVENTORY_MANAGER]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
  ],
  [UserRole.AUDITOR]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
    Permission.AUDIT_VIEW,
  ],
  [UserRole.VIEWER]: [
    Permission.FINANCE_COA_VIEW,
    Permission.FINANCE_REPORTS_VIEW,
  ],
};

export class AuthService {
  private db: DbClient;
  private secret: string;

  constructor(db: DbClient, secret: string = 'omnysync-dev-jwt-secret-key-32-chars-min') {
    this.db = db;
    this.secret = secret;
  }

  static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  static verifyPassword(password: string, combinedHash: string): boolean {
    const [salt, hash] = combinedHash.split(':');
    if (!salt || !hash) return false;
    const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  }

  /**
   * Generates a signed tamper-proof session token.
   */
  generateSessionToken(session: AuthSession): string {
    const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  /**
   * Verifies and extracts session payload from token.
   */
  verifySessionToken(token: string): AuthSession | null {
    try {
      const [payload, signature] = token.split('.');
      if (!payload || !signature) return null;

      const expectedSig = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return null;
      }

      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      return decoded as AuthSession;
    } catch {
      return null;
    }
  }

  /**
   * Resolves complete permissions for a user from their roles.
   */
  static resolvePermissions(roles: UserRole[]): string[] {
    const perms = new Set<string>();
    for (const role of roles) {
      const rolePerms = ROLE_PERMISSIONS[role] || [];
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
    return session.permissions.includes(permission);
  }
}
