/**
 * ADM / CFG: user & role administration, versioned organization settings and module
 * lifecycle. Guard rails: no self-lockout, the last active administrator cannot be removed,
 * role names are validated against the catalogue, every change is audited with before/after.
 */
import type { Express, Request, Response } from 'express';
import { Permission, UserRole, ErrorCode } from '@omnysync/contracts';
import { AuthService, ROLE_PERMISSIONS } from '@omnysync/platform';
import { db, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, notFound, validationError } from '../lib/errors.js';
import { audit, unitOfWork } from '../lib/resource.js';
import { arrayOf, int, oneOf, optionalStr, str } from '../lib/validate.js';
import { MODULES, moduleStates, validateModuleTransition } from '../lib/modules.js';

type SettingType = { kind: 'int'; min: number; max: number } | { kind: 'decimal'; min: string; max: string } | { kind: 'enum'; values: string[] } | { kind: 'bool' } | { kind: 'hours' } | { kind: 'text'; max: number };
export const SETTINGS: Record<string, { label: string; group: string; type: SettingType; default: unknown; help: string }> = {
  'sales.payment_terms_days': { label: 'Default payment terms (days)', group: 'Sales & AR', type: { kind: 'int', min: 0, max: 365 }, default: 30, help: 'Used for due dates on new invoices.' },
  'sales.credit_check': { label: 'Enforce credit limits', group: 'Sales & AR', type: { kind: 'bool' }, default: true, help: 'Block order confirmation beyond the customer limit.' },
  'pos.max_cashier_discount_pct': { label: 'Cashier discount limit (%)', group: 'POS', type: { kind: 'decimal', min: '0', max: '100' }, default: '10', help: 'Above this a manager PIN is required.' },
  'inventory.costing_method': { label: 'Inventory costing method', group: 'Inventory', type: { kind: 'enum', values: ['STANDARD', 'MOVING_AVERAGE', 'FIFO'] }, default: 'STANDARD', help: 'MOVING_AVERAGE re-computes unit cost on each receipt; FIFO values issues at the oldest receipt layers (ADR-016).' },
  'inventory.allow_negative_stock': { label: 'Allow negative stock', group: 'Inventory', type: { kind: 'bool' }, default: false, help: 'Never recommended; issues are blocked when off.' },
  'service.business_hours': { label: 'Service SLA business hours', group: 'Service', type: { kind: 'hours' }, default: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5, 6] }, help: 'SLA clocks only run inside these hours, in the organisation time zone.' },
  'service.default_labour_rate': { label: 'Default technician labour rate (PKR/h)', group: 'Service', type: { kind: 'decimal', min: '0', max: '1000000' }, default: '2500', help: 'Used when billing approved service time.' },
  'time.daily_overtime_after_hours': { label: 'Overtime after (hours/day)', group: 'Time', type: { kind: 'decimal', min: '1', max: '24' }, default: '8', help: 'Hours beyond this are overtime.' },
  'tax.default_output_code': { label: 'Default output tax code', group: 'Tax', type: { kind: 'text', max: 32 }, default: 'GST18', help: 'Applied when an item has no tax rate.' },
  'grc.risk_appetite': { label: 'Risk appetite (max acceptable residual score)', group: 'Risk', type: { kind: 'int', min: 1, max: 25 }, default: 8, help: 'Risks above this residual score (likelihood × impact) cannot be accepted without escalation.' },
  'org.timezone': { label: 'Organisation time zone', group: 'Organisation', type: { kind: 'enum', values: ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Europe/London', 'UTC', 'America/New_York'] }, default: 'Asia/Karachi', help: 'Local day and business-hour SLA clocks (SRV) use this zone.' },
  'finance.require_journal_approval': { label: 'Manual journals need approval', group: 'Finance', type: { kind: 'bool' }, default: true, help: 'Maker-checker on manual vouchers.' },
};

function parseSetting(key: string, raw: unknown): unknown {
  const def = SETTINGS[key];
  if (!def) throw notFound(`Setting ${key}`);
  const t = def.type;
  switch (t.kind) {
    case 'int':
      return int(raw, 'value', { min: t.min, max: t.max });
    case 'decimal': {
      const v = String(raw ?? '').trim();
      if (!/^\d+(\.\d{1,4})?$/.test(v)) throw validationError('value must be a decimal with at most 4 places', { field: 'value' });
      const n = Number(v);
      if (n < Number(t.min) || n > Number(t.max)) throw validationError(`value must be between ${t.min} and ${t.max}`, { field: 'value' });
      return v;
    }
    case 'enum':
      return oneOf(raw, 'value', t.values);
    case 'bool':
      if (typeof raw !== 'boolean') throw validationError('value must be true or false', { field: 'value' });
      return raw;
    case 'text':
      return str(raw, 'value', { max: t.max });
    case 'hours': {
      const v = raw as any;
      const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!v || !hhmm.test(v.start) || !hhmm.test(v.end) || v.start >= v.end) throw validationError('value needs start < end in HH:MM', { field: 'value' });
      if (!Array.isArray(v.days) || v.days.length === 0 || v.days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)) throw validationError('days must list weekdays 0-6', { field: 'value' });
      return { start: v.start, end: v.end, days: [...new Set(v.days as number[])].sort() };
    }
  }
}

export async function getSetting<T = unknown>(q: { query: typeof db.query }, org: string, key: string): Promise<T> {
  const r = await q.query(`SELECT value FROM org_settings WHERE organization_id = $1 AND setting_key = $2`, [org, key]);
  const v = r.rows[0]?.value;
  if (v === undefined) return SETTINGS[key]?.default as T;
  return v as T; // JSONB is decoded by the driver; re-parsing a string setting threw (e.g. tax.default_output_code)
}

const ROLE_NAMES = Object.values(UserRole) as string[];

export function registerConfigRoutes(app: Express): void {
  // ---------- Users & roles ----------
  app.get('/api/admin/users', authenticate, requirePermission(Permission.USER_MANAGE), async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT u.id, u.email, u.name, u.is_active AS user_active, m.roles, m.is_active, m.created_at
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 ORDER BY u.name`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows.map((x) => ({ ...x, roles: typeof x.roles === 'string' ? JSON.parse(x.roles) : x.roles, status: x.is_active && x.user_active ? 'ACTIVE' : 'SUSPENDED' })));
  });

  app.get('/api/admin/roles', authenticate, requireAnyPermission(Permission.USER_MANAGE, Permission.CONFIG_VIEW), async (req: Request, res: Response) => {
    return ok(req, res, ROLE_NAMES.map((r) => ({ id: r, code: r, name: r.replace(/_/g, ' '), permissions: ROLE_PERMISSIONS[r as UserRole] || [], permission_count: (ROLE_PERMISSIONS[r as UserRole] || []).length })));
  });

  app.post('/api/admin/users', authenticate, requirePermission(Permission.USER_MANAGE), async (req: Request, res: Response) => {
    const email = str(req.body?.email, 'email', { max: 255, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ }).toLowerCase();
    const name = str(req.body?.name, 'name', { max: 200 });
    const password = str(req.body?.initial_password, 'initial_password', { min: 12, max: 128 });
    const roles = arrayOf<string>(req.body?.roles, 'roles', { min: 1, max: 5 }).map((r) => oneOf(r, 'roles', ROLE_NAMES));
    const out = await unitOfWork(req, async (ctx) => {
      const exists = await ctx.tx.query(`SELECT id FROM users WHERE email = $1`, [email]);
      let userId: string = exists.rows[0]?.id;
      if (userId) {
        const mem = await ctx.tx.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND organization_id = $2`, [userId, ctx.org]);
        if (mem.rows.length) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, 'This user is already a member of the organization', { field: 'email' });
      } else {
        userId = (await ctx.tx.query(`INSERT INTO users (id, email, name, password_hash, is_active) VALUES (gen_random_uuid(), $1, $2, $3, true) RETURNING id`, [email, name, AuthService.hashPassword(password)])).rows[0].id;
      }
      await ctx.tx.query(`INSERT INTO memberships (id, organization_id, legal_entity_id, user_id, roles, is_active) VALUES (gen_random_uuid(), $1, $2, $3, $4, true)`, [ctx.org, ctx.le, userId, JSON.stringify(roles)]);
      await audit(ctx, 'USER_INVITED', 'USER', userId, undefined, { email, roles });
      return { id: userId, email, name, roles, status: 'ACTIVE' };
    });
    return ok(req, res, out, 201);
  });

  const activeAdmins = async (q: any, org: string, excludeUser?: string) =>
    (
      await q.query(
        `SELECT COUNT(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.is_active AND u.is_active AND m.roles::jsonb ? 'ADMIN' AND ($2::uuid IS NULL OR m.user_id <> $2::uuid)`,
        [org, excludeUser ?? null],
      )
    ).rows[0].n as number;

  app.post('/api/admin/users/:id/roles', authenticate, requirePermission(Permission.USER_MANAGE), async (req: Request, res: Response) => {
    const roles = arrayOf<string>(req.body?.roles, 'roles', { min: 1, max: 5 }).map((r) => oneOf(r, 'roles', ROLE_NAMES));
    const reason = optionalStr(req.body?.reason, 'reason', 500);
    const out = await unitOfWork(req, async (ctx) => {
      const m = (await ctx.tx.query(`SELECT * FROM memberships WHERE user_id::text = $1 AND organization_id = $2 FOR UPDATE`, [req.params.id, ctx.org])).rows[0];
      if (!m) throw notFound('User');
      const before = typeof m.roles === 'string' ? JSON.parse(m.roles) : m.roles;
      if (m.user_id === ctx.user && before.includes('ADMIN') && !roles.includes('ADMIN')) {
        throw new ApiError(409, ErrorCode.INVALID_STATE, 'You cannot remove your own administrator role (self-lockout guard)');
      }
      if (before.includes('ADMIN') && !roles.includes('ADMIN') && (await activeAdmins(ctx.tx, ctx.org, m.user_id)) === 0) {
        throw new ApiError(409, ErrorCode.INVALID_STATE, 'At least one active administrator must remain');
      }
      await ctx.tx.query(`UPDATE memberships SET roles = $1 WHERE id = $2`, [JSON.stringify([...new Set(roles)]), m.id]);
      await audit(ctx, 'USER_ROLES_CHANGED', 'USER', m.user_id, { roles: before }, { roles, reason });
      return { id: m.user_id, roles };
    });
    return ok(req, res, out);
  });

  for (const [action, active] of [['suspend', false], ['reactivate', true]] as const) {
    app.post(`/api/admin/users/:id/${action}`, authenticate, requirePermission(Permission.USER_MANAGE), async (req: Request, res: Response) => {
      const out = await unitOfWork(req, async (ctx) => {
        const m = (await ctx.tx.query(`SELECT * FROM memberships WHERE user_id::text = $1 AND organization_id = $2 FOR UPDATE`, [req.params.id, ctx.org])).rows[0];
        if (!m) throw notFound('User');
        if (!active && m.user_id === ctx.user) throw new ApiError(409, ErrorCode.INVALID_STATE, 'You cannot suspend your own account');
        const roles = typeof m.roles === 'string' ? JSON.parse(m.roles) : m.roles;
        if (!active && roles.includes('ADMIN') && (await activeAdmins(ctx.tx, ctx.org, m.user_id)) === 0) throw new ApiError(409, ErrorCode.INVALID_STATE, 'At least one active administrator must remain');
        await ctx.tx.query(`UPDATE memberships SET is_active = $1 WHERE id = $2`, [active, m.id]);
        await audit(ctx, active ? 'USER_REACTIVATED' : 'USER_SUSPENDED', 'USER', m.user_id, { is_active: m.is_active }, { is_active: active });
        return { id: m.user_id, status: active ? 'ACTIVE' : 'SUSPENDED' };
      });
      return ok(req, res, out);
    });
  }

  // ---------- Settings ----------
  app.get('/api/config/settings', authenticate, requireAnyPermission(Permission.CONFIG_VIEW, Permission.CONFIG_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = await db.query(`SELECT * FROM org_settings WHERE organization_id = $1`, [org]);
    const byKey = new Map(r.rows.map((x) => [x.setting_key, x]));
    return ok(
      req,
      res,
      Object.entries(SETTINGS).map(([key, d]) => {
        const row = byKey.get(key);
        // JSONB comes back already decoded; a string setting (e.g. "FIFO") must not be JSON.parse'd again
        // (that threw and broke the whole settings page once an enum setting had been saved).
        const v = row ? row.value : d.default;
        return { id: key, key, label: d.label, group: d.group, kind: d.type.kind, options: (d.type as any).values, help: d.help, value: v, is_default: !row, version: row?.version ?? 0, updated_at: row?.updated_at ?? null };
      }),
    );
  });

  app.get('/api/config/settings/:key/history', authenticate, requireAnyPermission(Permission.CONFIG_VIEW, Permission.CONFIG_MANAGE), async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT h.*, u.name AS changed_by_name FROM org_setting_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.organization_id = $1 AND h.setting_key = $2 ORDER BY h.version DESC LIMIT 50`,
      [req.session!.organization_id, req.params.key],
    );
    return ok(req, res, r.rows);
  });

  app.post('/api/config/settings/:key', authenticate, requirePermission(Permission.CONFIG_MANAGE), async (req: Request, res: Response) => {
    const key = req.params.key;
    const value = parseSetting(key, req.body?.value);
    const expected = int(req.body?.version, 'version', { min: 0 });
    const reason = optionalStr(req.body?.reason, 'reason', 500);
    const out = await unitOfWork(req, async (ctx) => {
      const cur = (await ctx.tx.query(`SELECT * FROM org_settings WHERE organization_id = $1 AND setting_key = $2 FOR UPDATE`, [ctx.org, key])).rows[0];
      const curVersion = cur?.version ?? 0;
      if (curVersion !== expected) throw new ApiError(409, ErrorCode.STALE_REVISION, `Setting changed meanwhile (now version ${curVersion}); reload and retry`, { current_version: curVersion });
      const next = curVersion + 1;
      await ctx.tx.query(
        `INSERT INTO org_settings (organization_id, setting_key, value, version, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (organization_id, setting_key) DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [ctx.org, key, JSON.stringify(value), next, ctx.user],
      );
      await ctx.tx.query(`INSERT INTO org_setting_history (organization_id, setting_key, version, old_value, new_value, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        ctx.org, key, next, cur ? JSON.stringify(cur.value) : null, JSON.stringify(value), reason, ctx.user,
      ]);
      await audit(ctx, 'SETTING_CHANGED', 'SETTING', ctx.org, { key, value: cur?.value ?? SETTINGS[key].default }, { key, value, version: next, reason });
      return { key, value, version: next };
    });
    return ok(req, res, out);
  });

  // ---------- Modules ----------
  app.get('/api/config/modules', authenticate, requireAnyPermission(Permission.CONFIG_VIEW, Permission.CONFIG_MANAGE, Permission.ORG_MANAGE), async (req: Request, res: Response) => {
    const states = await moduleStates(db, req.session!.organization_id);
    return ok(req, res, MODULES.map((m) => ({ id: m.code, ...m, state: states.get(m.code), dependents: MODULES.filter((x) => x.depends.includes(m.code)).map((x) => x.code) })));
  });

  app.post('/api/config/modules/:code/state', authenticate, requirePermission(Permission.ORG_MANAGE), async (req: Request, res: Response) => {
    const code = String(req.params.code).toUpperCase();
    const to = oneOf(req.body?.state, 'state', ['enabled', 'draining', 'read_only', 'disabled'] as const);
    const reason = str(req.body?.reason, 'reason', { max: 500 });
    const out = await unitOfWork(req, async (ctx) => {
      await ctx.tx.query(`SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE`, [ctx.org]);
      const states = await moduleStates(ctx.tx, ctx.org);
      const err = validateModuleTransition(code, to, states);
      if (err) throw new ApiError(409, ErrorCode.INVALID_STATE, err);
      const from = states.get(code);
      await ctx.tx.query(
        `INSERT INTO module_states (organization_id, module_code, state, reason, changed_by, changed_at) VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (organization_id, module_code) DO UPDATE SET state = EXCLUDED.state, reason = EXCLUDED.reason, changed_by = EXCLUDED.changed_by, changed_at = NOW()`,
        [ctx.org, code, to, reason, ctx.user],
      );
      await audit(ctx, 'MODULE_STATE_CHANGED', 'MODULE', ctx.org, { module: code, state: from }, { module: code, state: to, reason });
      return { code, from, state: to };
    });
    return ok(req, res, out);
  });
}
