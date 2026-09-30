/**
 * Declarative resource kit used by the newer modules (SRV, CRM, TIM, SUP, LOG, DOC, FLT,
 * GRC, LND, EPM, TAL, COM, TAX, WMS, CFG). One definition yields list / detail / create /
 * update / command endpoints that all inherit MODULE-CONTRACT.md:
 *  - permission per action (view / create / update / each command),
 *  - tenant isolation (every query filters organization_id; foreign references are
 *    checked with assertOrgRef so another tenant's id reads as "does not exist"),
 *  - server-side validation of every declared field (exact decimals, calendar dates,
 *    enums, lengths) with field-level error details,
 *  - optimistic concurrency on update (`revision` must match, else STALE_REVISION),
 *  - atomic compare-and-set state commands (two concurrent approvals cannot both win),
 *  - audit record + outbox event (`<EVENT>_<ACTION>`) inside the same unit of work, which
 *    feeds event-triggered automation rules,
 *  - bounded pagination and whitelisted search / filter columns (no caller SQL).
 * Domain-specific behaviour is injected through hooks (beforeCreate, command.run) so the
 * invariants stay next to the module's own routes.
 */
import type { Express, Request, Response, RequestHandler } from 'express';
import { Permission, ErrorCode } from '@omnysync/contracts';
import type { DbClient } from '@omnysync/platform';
import { db, authenticate, requireAnyPermission, auditLogger, outboxService } from '../context.js';
import { ok } from './http.js';
import { ApiError, notFound, validationError } from './errors.js';
import { assertOrgRef } from './scope.js';
import { transition } from './state.js';
import { nextDocumentNumber } from './numbering.js';
import { requireModule } from './modules.js';
import { bool, dateOnly, decimal, int, oneOf, pagination, str, todayIso } from './validate.js';

export type FieldSpec =
  | { type: 'string'; required?: boolean; max?: number; pattern?: RegExp }
  | { type: 'text'; required?: boolean; max?: number }
  | { type: 'decimal'; required?: boolean; sign?: 'any' | 'nonNegative' | 'positive'; scale?: number; default?: string }
  | { type: 'int'; required?: boolean; min?: number; max?: number; default?: number }
  | { type: 'bool'; default?: boolean }
  | { type: 'date'; required?: boolean; defaultToday?: boolean }
  | { type: 'datetime'; required?: boolean }
  | { type: 'enum'; values: readonly string[]; required?: boolean; default?: string }
  | { type: 'ref'; table: string; required?: boolean; label?: string }
  | { type: 'json'; required?: boolean };

export interface Ctx {
  req: Request;
  tx: DbClient;
  org: string;
  le: string;
  user: string;
}

export interface CommandSpec {
  from: readonly string[];
  to?: string;
  permission?: Permission | Permission[];
  /** Extra body fields validated for this command. */
  fields?: Record<string, FieldSpec>;
  /** Runs inside the transaction after the row is locked. Return columns to set / response data. */
  run?: (ctx: Ctx, row: any, input: Record<string, any>) => Promise<{ set?: Record<string, unknown>; data?: unknown } | void>;
  /** Separation of duties: the actor may not equal row[column]. */
  sodColumn?: string;
}

export interface ResourceSpec {
  path: string;
  table: string;
  label: string;
  event: string;
  /** Module code for lifecycle enforcement (MODULE-CONTRACT: draining / read-only). */
  module?: string;
  view: Permission | Permission[];
  create?: Permission | Permission[] | false;
  update?: Permission | Permission[] | false;
  fields: Record<string, FieldSpec>;
  /** Fields that may be edited after creation (default: all). */
  editable?: string[];
  /** Statuses in which update is allowed (default: any non-terminal listed; undefined = all). */
  editableIn?: readonly string[];
  numbering?: { column: string; prefix: string; dateField?: string };
  initialStatus?: string;
  statusColumn?: string | false;
  search?: string[];
  filters?: string[];
  orderBy?: string;
  /** SELECT list + joins for list/detail, aliased `t` for the main table. */
  select?: string;
  joins?: string;
  beforeCreate?: (ctx: Ctx, values: Record<string, any>) => Promise<void>;
  afterCreate?: (ctx: Ctx, row: any) => Promise<void>;
  beforeUpdate?: (ctx: Ctx, row: any, values: Record<string, any>) => Promise<void>;
  commands?: Record<string, CommandSpec>;
  /** Extra detail payload (children) for GET /:id. */
  detail?: (q: DbClient, row: any, org: string) => Promise<Record<string, unknown>>;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const perms = (p: Permission | Permission[]) => (Array.isArray(p) ? p : [p]);
const guard = (p: Permission | Permission[]): RequestHandler => requireAnyPermission(...perms(p)) as RequestHandler;

export function parseField(name: string, spec: FieldSpec, raw: unknown, partial = false): unknown {
  const missing = raw === undefined || raw === null || raw === '';
  if (partial && raw === undefined) return undefined;
  switch (spec.type) {
    case 'string':
      return str(raw, name, { required: !!spec.required, max: spec.max ?? 255, pattern: spec.pattern }) || null;
    case 'text':
      return str(raw, name, { required: !!spec.required, max: spec.max ?? 5000 }) || null;
    case 'decimal':
      if (missing && !spec.required) return spec.default ?? null;
      return decimal(raw, name, { sign: spec.sign ?? 'nonNegative', scale: spec.scale ?? 8 });
    case 'int':
      if (missing && !spec.required) return spec.default ?? null;
      return int(raw, name, { min: spec.min, max: spec.max });
    case 'bool':
      return bool(raw, spec.default ?? false);
    case 'date':
      if (missing && !spec.required) return spec.defaultToday ? todayIso() : null;
      return dateOnly(raw, name);
    case 'datetime': {
      if (missing) {
        if (spec.required) throw validationError(`${name} is required`, { field: name });
        return null;
      }
      const d = new Date(String(raw));
      if (typeof raw !== 'string' || Number.isNaN(d.getTime())) throw validationError(`${name} must be an ISO date-time`, { field: name });
      return d.toISOString();
    }
    case 'enum':
      if (missing && !spec.required) return spec.default ?? null;
      return oneOf(raw, name, spec.values);
    case 'ref':
      if (missing) {
        if (spec.required) throw validationError(`${name} is required`, { field: name });
        return null;
      }
      if (typeof raw !== 'string' || raw.length > 64) throw validationError(`${name} must be an identifier`, { field: name });
      return raw;
    case 'json':
      if (missing) {
        if (spec.required) throw validationError(`${name} is required`, { field: name });
        return null;
      }
      if (typeof raw !== 'object') throw validationError(`${name} must be an object or list`, { field: name });
      if (JSON.stringify(raw).length > 20000) throw validationError(`${name} is too large`, { field: name });
      return JSON.stringify(raw);
  }
}

export async function parseFields(q: DbClient, org: string, fields: Record<string, FieldSpec>, body: any, partial = false) {
  const out: Record<string, any> = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (!IDENT.test(name)) throw new Error(`Illegal field ${name}`);
    const v = parseField(name, spec, body?.[name], partial);
    if (v === undefined) continue;
    if (spec.type === 'ref' && v) await assertOrgRef(q, spec.table, v, org, spec.label || name);
    out[name] = v;
  }
  return out;
}

export async function audit(ctx: Ctx, action: string, type: string, id: string, before?: unknown, after?: unknown) {
  await auditLogger.record(
    { organization_id: ctx.org, user_id: ctx.user, action, entity_type: type, entity_id: id, before_state: before as any, after_state: after as any, correlation_id: ctx.req.correlationId },
    ctx.tx,
  );
}

export async function emit(ctx: Ctx, eventType: string, payload: Record<string, unknown>) {
  await outboxService.emit({ organization_id: ctx.org, event_type: eventType, payload }, ctx.tx);
}

export function ctxOf(req: Request, tx: DbClient): Ctx {
  return { req, tx, org: req.session!.organization_id, le: req.session!.legal_entity_id, user: req.session!.user_id };
}

/** Runs `fn` in one unit of work with a request context. */
export function unitOfWork<T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(ctxOf(req, tx)));
}

export async function loadRow(q: DbClient, table: string, id: unknown, org: string, label: string, forUpdate = false) {
  if (!IDENT.test(table)) throw new Error('Illegal table');
  if (typeof id !== 'string' || !id || id.length > 64) throw notFound(label);
  const r = await q.query(`SELECT * FROM ${table} WHERE id::text = $1 AND organization_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [id, org]);
  if (!r.rows[0]) throw notFound(label);
  return r.rows[0];
}

export function defineResource(app: Express, spec: ResourceSpec): void {
  if (!IDENT.test(spec.table)) throw new Error('Illegal table');
  const statusCol = spec.statusColumn === false ? null : spec.statusColumn || 'status';
  const select = spec.select || 't.*';
  const joins = spec.joins || '';
  const searchCols = spec.search || [];
  const filterCols = [...(spec.filters || []), ...(statusCol ? [statusCol] : [])];
  const orderBy = spec.orderBy || 't.created_at DESC';
  const passthrough: RequestHandler = (_req, _res, next) => next();
  const modCreate = spec.module ? (requireModule(spec.module, 'create') as RequestHandler) : passthrough;
  const modCmd = spec.module ? (requireModule(spec.module, 'command') as RequestHandler) : passthrough;

  app.get(spec.path, authenticate, guard(spec.view), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const { limit, offset } = pagination(req.query as any);
    const params: unknown[] = [org];
    const where = ['t.organization_id = $1'];
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q && searchCols.length) {
      params.push(`%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
      where.push(`(${searchCols.map((c) => `${c.includes('.') ? c : 't.' + c}::text ILIKE $${params.length}`).join(' OR ')})`);
    }
    for (const f of filterCols) {
      const v = req.query[f];
      if (typeof v === 'string' && v) {
        if (!IDENT.test(f)) continue;
        const values = v.split(',').slice(0, 20);
        params.push(values);
        where.push(`t.${f}::text = ANY($${params.length}::text[])`);
      }
    }
    const base = `FROM ${spec.table} t ${joins} WHERE ${where.join(' AND ')}`;
    const count = await db.query(`SELECT COUNT(*)::int AS n ${base}`, params);
    const rows = await db.query(`SELECT ${select} ${base} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, params);
    return ok(req, res, rows.rows, 200, { total_count: count.rows[0].n, limit, offset });
  });

  app.get(`${spec.path}/:id`, authenticate, guard(spec.view), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = await db.query(`SELECT ${select} FROM ${spec.table} t ${joins} WHERE t.organization_id = $1 AND t.id::text = $2`, [org, req.params.id]);
    if (!r.rows[0]) throw notFound(spec.label);
    const extra = spec.detail ? await spec.detail(db, r.rows[0], org) : {};
    return ok(req, res, { ...r.rows[0], ...extra });
  });

  if (spec.create !== false) {
    app.post(spec.path, authenticate, guard(spec.create || spec.view), modCreate, async (req: Request, res: Response) => {
      const out = await unitOfWork(req, async (ctx) => {
        const values = await parseFields(ctx.tx, ctx.org, spec.fields, req.body);
        if (spec.beforeCreate) await spec.beforeCreate(ctx, values);
        if (spec.numbering && !values[spec.numbering.column]) {
          const d = spec.numbering.dateField ? values[spec.numbering.dateField] : undefined;
          values[spec.numbering.column] = await nextDocumentNumber(ctx.tx, ctx.org, spec.numbering.prefix, d || todayIso());
        }
        if (statusCol && spec.initialStatus && values[statusCol] === undefined) values[statusCol] = spec.initialStatus;
        const cols = ['organization_id', 'legal_entity_id', 'created_by', ...Object.keys(values)];
        const vals = [ctx.org, ctx.le, ctx.user, ...Object.values(values)];
        for (const c of cols) if (!IDENT.test(c)) throw new Error('Illegal column');
        const r = await ctx.tx.query(
          `INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
          vals,
        );
        const row = r.rows[0];
        if (spec.afterCreate) await spec.afterCreate(ctx, row);
        await audit(ctx, `${spec.event}_CREATED`, spec.event, row.id, undefined, values);
        await emit(ctx, `${spec.event}_CREATED`, { id: row.id, ...pickScalars(row) });
        return row;
      });
      return ok(req, res, out, 201);
    });
  }

  if (spec.update !== false) {
    app.post(`${spec.path}/:id/update`, authenticate, guard(spec.update || spec.create || spec.view), modCmd, async (req: Request, res: Response) => {
      const out = await unitOfWork(req, async (ctx) => {
        const row = await loadRow(ctx.tx, spec.table, req.params.id, ctx.org, spec.label, true);
        const rev = int(req.body?.revision, 'revision', { min: 1 });
        if (Number(row.revision) !== rev) {
          throw new ApiError(409, ErrorCode.STALE_REVISION, `${spec.label} was changed by someone else (revision ${row.revision}); reload and retry`, { current_revision: row.revision });
        }
        if (statusCol && spec.editableIn && !spec.editableIn.includes(row[statusCol])) {
          throw new ApiError(409, ErrorCode.INVALID_STATE, `${spec.label} cannot be edited in status ${row[statusCol]}`);
        }
        const editable = spec.editable || Object.keys(spec.fields);
        const fields = Object.fromEntries(Object.entries(spec.fields).filter(([k]) => editable.includes(k)));
        const values = await parseFields(ctx.tx, ctx.org, fields, req.body, true);
        if (spec.beforeUpdate) await spec.beforeUpdate(ctx, row, values);
        const sets = Object.keys(values).map((k, i) => `${k} = $${i + 3}`);
        const r = await ctx.tx.query(
          `UPDATE ${spec.table} SET ${[...sets, 'revision = revision + 1', 'updated_at = NOW()'].join(', ')} WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [row.id, ctx.org, ...Object.values(values)],
        );
        await audit(ctx, `${spec.event}_UPDATED`, spec.event, row.id, pickScalars(row), values);
        await emit(ctx, `${spec.event}_UPDATED`, { id: row.id, ...pickScalars(r.rows[0]) });
        return r.rows[0];
      });
      return ok(req, res, out);
    });
  }

  for (const [name, cmd] of Object.entries(spec.commands || {})) {
    const action = name.toUpperCase().replace(/-/g, '_');
    app.post(`${spec.path}/:id/${name}`, authenticate, guard(cmd.permission || spec.update || spec.create || spec.view), modCmd, async (req: Request, res: Response) => {
      const out = await unitOfWork(req, async (ctx) => {
        const row = await loadRow(ctx.tx, spec.table, req.params.id, ctx.org, spec.label, true);
        if (statusCol && cmd.from.length && !cmd.from.includes(row[statusCol])) {
          throw new ApiError(409, ErrorCode.INVALID_STATE, `${spec.label} cannot ${name} from ${row[statusCol]} (allowed from: ${cmd.from.join(', ')})`, {
            current: row[statusCol],
            allowed_from: cmd.from,
          });
        }
        if (cmd.sodColumn && row[cmd.sodColumn] && row[cmd.sodColumn] === ctx.user) {
          throw new ApiError(403, ErrorCode.SEGREGATION_OF_DUTIES, `Segregation of duties: you cannot ${name} a ${spec.label.toLowerCase()} you ${cmd.sodColumn.replace(/_by$/, '')}`);
        }
        const input = cmd.fields ? await parseFields(ctx.tx, ctx.org, cmd.fields, req.body) : {};
        const r = cmd.run ? (await cmd.run(ctx, row, input)) || {} : {};
        let updated = row;
        const set = { ...(r.set || {}), updated_at: new Date().toISOString() } as Record<string, unknown>;
        if (statusCol && cmd.to) {
          updated = await transition(ctx.tx, { table: spec.table, id: row.id, organizationId: ctx.org, from: cmd.from, to: cmd.to, label: spec.label, statusColumn: statusCol, set: { ...set, revision: Number(row.revision) + 1 } });
        } else if (Object.keys(r.set || {}).length) {
          const keys = Object.keys(set);
          for (const k of keys) if (!IDENT.test(k)) throw new Error('Illegal column');
          updated = (await ctx.tx.query(`UPDATE ${spec.table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, revision = revision + 1 WHERE id = $1 RETURNING *`, [row.id, ...Object.values(set)])).rows[0];
        }
        await audit(ctx, `${spec.event}_${action}`, spec.event, row.id, pickScalars(row), { ...input, ...(r.set || {}), status: statusCol ? updated[statusCol] : undefined });
        await emit(ctx, `${spec.event}_${action}`, { id: row.id, ...pickScalars(updated) });
        return r.data !== undefined ? { ...updated, result: r.data } : updated;
      });
      return ok(req, res, out);
    });
  }
}

/** Scalar, non-sensitive columns only (outbox payloads never carry blobs). */
export function pickScalars(row: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (k === 'content' || k === 'content_base64' || k === 'pin_hash' || k === 'password_hash') continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
    else if (v instanceof Date) out[k] = v.toISOString();
  }
  return out;
}

/** Standard audit columns every kit table carries. */
export const STD_COLUMNS = `
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE RESTRICT,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
