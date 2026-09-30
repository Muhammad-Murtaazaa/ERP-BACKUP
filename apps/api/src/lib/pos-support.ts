import type { Request } from 'express';
import crypto from 'node:crypto';
import { AuthService, DbClient } from '@omnysync/platform';
import { Money, type Promotion } from '@omnysync/financial-engine';
import { ErrorCode, Permission } from '@omnysync/contracts';
import { ApiError, validationError } from './errors.js';

/** Manager-level POS capability (overrides, voids, no-receipt returns...). */
export function isPosManager(req: Request): boolean {
  return AuthService.hasPermission(req.session!, Permission.POS_REGISTER_MANAGE);
}

/** Converts a pure-engine Error into a typed API error. */
export function engine<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    const msg = String(err?.message || err);
    if (/Insufficient tender/.test(msg)) throw new ApiError(422, ErrorCode.INSUFFICIENT_PAYMENT_TENDER, msg);
    if (/Non-cash tenders cannot exceed/.test(msg)) throw new ApiError(422, ErrorCode.INSUFFICIENT_PAYMENT_TENDER, msg);
    if (/Refund exceeds|only .* remain returnable/.test(msg)) throw new ApiError(422, ErrorCode.RETURN_NOT_ALLOWED, msg);
    throw validationError(msg);
  }
}

export const POS_ACTIONS = [
  'PRICE_OVERRIDE',
  'DISCOUNT',
  'VOID_LINE',
  'VOID_ORDER',
  'RETURN',
  'RETURN_NO_RECEIPT',
  'NO_SALE',
  'PAID_OUT',
  'CLOSE_VARIANCE',
  'NEGATIVE_STOCK',
] as const;
export type PosAction = (typeof POS_ACTIONS)[number];

export async function posEvent(
  q: DbClient,
  req: Request,
  e: { registerId?: string | null; sessionId?: string | null; type: string; referenceId?: string | null; details?: unknown },
): Promise<void> {
  await q.query(
    `INSERT INTO pos_audit_events (organization_id, register_id, session_id, user_id, event_type, reference_id, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.session!.organization_id, e.registerId ?? null, e.sessionId ?? null, req.session!.user_id, e.type, e.referenceId ?? null, e.details ? JSON.stringify(e.details) : null],
  );
}

/**
 * Verifies that `approvalId` is an unexpired, unconsumed approval of `action` for
 * this session and consumes it (single use). Managers acting on their own terminal
 * do not need one — their own POS_REGISTER_MANAGE permission is the authority,
 * recorded in the audit trail as a self-authorised action.
 * Returns the approving user id (or the manager's own id).
 */
export async function requireApproval(
  q: DbClient,
  req: Request,
  action: PosAction,
  sessionId: string,
  approvalId: unknown,
  consumedRef: string,
): Promise<string> {
  if (!approvalId && isPosManager(req)) return req.session!.user_id;
  if (!approvalId || typeof approvalId !== 'string') {
    throw new ApiError(403, ErrorCode.APPROVAL_REQUIRED, `Manager approval required: ${action}`, { action });
  }
  const r = await q.query(
    `UPDATE pos_approvals SET consumed_at = NOW(), consumed_ref = $5
     WHERE id::text = $1 AND organization_id = $2 AND session_id = $3 AND action = $4
       AND consumed_at IS NULL AND expires_at > NOW() AND requested_by = $6
     RETURNING approved_by`,
    [approvalId, req.session!.organization_id, sessionId, action, consumedRef, req.session!.user_id],
  );
  if (r.rows.length === 0) {
    throw new ApiError(403, ErrorCode.APPROVAL_INVALID, `Approval is invalid, expired, already used or not for ${action}`, { action });
  }
  return r.rows[0].approved_by;
}

const MAX_PIN_FAILURES = 5;
const LOCK_MINUTES = 15;

/**
 * Verifies a manager PIN within the organization. The approver must hold
 * POS_REGISTER_MANAGE, must differ from the requesting cashier (SoD, also a DB
 * CHECK) and PINs lock after repeated failures. Every attempt is audited.
 */
export async function verifyManagerPin(q: DbClient, req: Request, pin: string): Promise<{ userId: string; name: string }> {
  if (!/^\d{4,8}$/.test(pin)) throw validationError('PIN must be 4-8 digits', { field: 'pin' });
  const org = req.session!.organization_id;
  const rows = await q.query(
    `SELECT mp.*, u.name, m.roles FROM pos_manager_pins mp
     JOIN users u ON u.id = mp.user_id AND u.is_active = true
     JOIN memberships m ON m.user_id = mp.user_id AND m.organization_id = mp.organization_id AND m.is_active = true
     WHERE mp.organization_id = $1
     ORDER BY mp.user_id
     FOR UPDATE OF mp`,
    [org],
  );
  let match: any = null;
  for (const row of rows.rows) {
    if (AuthService.verifyPassword(pin, row.pin_hash)) {
      match = row;
      break;
    }
  }
  if (!match) {
    // Count the failure against every PIN holder? No: against the requesting terminal user
    // via the audit trail; lock the terminal user after MAX failures in LOCK window.
    const fails = await q.query(
      `SELECT COUNT(*)::int AS n FROM pos_audit_events WHERE organization_id = $1 AND user_id = $2
       AND event_type = 'APPROVAL_PIN_FAILED' AND created_at > NOW() - ($3 || ' minutes')::interval`,
      [org, req.session!.user_id, String(LOCK_MINUTES)],
    );
    if (fails.rows[0].n + 1 >= MAX_PIN_FAILURES) {
      throw new ApiError(423, ErrorCode.PIN_LOCKED, `Too many invalid PIN attempts; approvals are locked for ${LOCK_MINUTES} minutes`);
    }
    throw new ApiError(403, ErrorCode.APPROVAL_INVALID, 'Invalid manager PIN');
  }
  if (match.locked_until && new Date(match.locked_until) > new Date()) {
    throw new ApiError(423, ErrorCode.PIN_LOCKED, 'This manager PIN is temporarily locked');
  }
  const roles = typeof match.roles === 'string' ? JSON.parse(match.roles) : match.roles;
  const perms = AuthService.resolvePermissions(roles);
  if (!perms.includes(Permission.POS_REGISTER_MANAGE)) throw new ApiError(403, ErrorCode.APPROVAL_INVALID, 'PIN holder is not a POS manager');
  if (match.user_id === req.session!.user_id) {
    throw new ApiError(403, ErrorCode.SEGREGATION_OF_DUTIES, 'A cashier cannot approve their own override');
  }
  return { userId: match.user_id, name: match.name };
}

export async function recentPinFailures(q: DbClient, req: Request): Promise<number> {
  const r = await q.query(
    `SELECT COUNT(*)::int AS n FROM pos_audit_events WHERE organization_id = $1 AND user_id = $2
     AND event_type = 'APPROVAL_PIN_FAILED' AND created_at > NOW() - ($3 || ' minutes')::interval`,
    [req.session!.organization_id, req.session!.user_id, String(LOCK_MINUTES)],
  );
  return r.rows[0].n;
}
export { MAX_PIN_FAILURES, LOCK_MINUTES };

/** Active promotions for a business date, mapped into engine rules. */
export async function activePromotions(q: DbClient, organizationId: string, businessDate: string): Promise<Promotion[]> {
  const r = await q.query(
    `SELECT * FROM pos_promotions WHERE organization_id = $1 AND is_active = true
       AND (starts_on IS NULL OR starts_on <= $2::date) AND (ends_on IS NULL OR ends_on >= $2::date)
     ORDER BY priority DESC, code ASC`,
    [organizationId, businessDate],
  );
  return r.rows.map((p: any) => {
    const rule = typeof p.rule === 'string' ? JSON.parse(p.rule) : p.rule || {};
    return { ...rule, id: p.id, code: p.code, name: p.name, type: p.promo_type, priority: p.priority } as Promotion;
  });
}

export function toMoneyStr(v: unknown, scale = 2): string {
  return new Money(String(v ?? '0')).toFixed(scale);
}

export function newCode(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Receipts (plain text for thermal printers + inline-styled HTML for email)
// ---------------------------------------------------------------------------

const W = 42;
const pad = (l: string, r: string) => {
  const space = Math.max(1, W - l.length - r.length);
  return l.slice(0, W - r.length - 1) + ' '.repeat(space) + r;
};
const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderReceipt(order: any, lines: any[], tenders: any[], register: any, opts: { reprint?: boolean } = {}) {
  const f = (v: unknown) => new Money(String(v ?? '0')).format(2);
  const header = String(register?.receipt_header || 'OMNYSYNC').split('\n');
  const footer = String(register?.receipt_footer || 'Thank you!').split('\n');
  const text: string[] = [];
  header.forEach((h) => text.push(center(h)));
  if (opts.reprint) text.push(center('*** REPRINT ***'));
  if (order.status === 'VOIDED') text.push(center('*** VOIDED ***'));
  text.push('-'.repeat(W));
  text.push(pad(`Receipt ${order.order_number}`, String(order.business_date || '').slice(0, 10)));
  text.push(pad(`Register ${register?.register_code || ''}`, `Cashier ${order.cashier_name || ''}`.slice(0, 20)));
  if (order.customer_name) text.push(`Customer: ${order.customer_name}`);
  text.push('-'.repeat(W));
  for (const l of lines) {
    text.push(String(l.item_name).slice(0, W));
    text.push(pad(`  ${new Money(l.quantity).format(3).replace(/\.?0+$/, '')} x ${f(l.unit_price)}`, f(l.gross_amount || l.line_total)));
    if (new Money(l.discount_amount || '0').isPositive()) text.push(pad(`  Savings${l.applied_promotions?.length ? ' (' + l.applied_promotions.join(',') + ')' : ''}`, `-${f(l.discount_amount)}`));
  }
  text.push('-'.repeat(W));
  text.push(pad('Subtotal', f(order.subtotal)));
  if (new Money(order.discount_amount || '0').isPositive()) text.push(pad('You saved', `-${f(order.discount_amount)}`));
  text.push(pad('Tax', f(order.tax_amount)));
  if (!new Money(order.cash_rounding || '0').isZero()) text.push(pad('Cash rounding', f(order.cash_rounding)));
  text.push(pad('TOTAL', f(new Money(order.total_amount).add(order.cash_rounding || '0'))));
  for (const t of tenders) text.push(pad(`  ${t.tender_type}${t.reference ? ' ' + String(t.reference).slice(-4) : ''}`, f(t.amount_tendered)));
  text.push(pad('Change', f(order.change_due)));
  if (order.loyalty_points_earned) text.push(`Points earned: ${order.loyalty_points_earned}`);
  text.push('-'.repeat(W));
  footer.forEach((h) => text.push(center(h)));

  const row = (l: string, r: string, bold = false) =>
    `<tr><td style="padding:2px 0;${bold ? 'font-weight:600;' : ''}">${esc(l)}</td><td style="padding:2px 0;text-align:right;${bold ? 'font-weight:600;' : ''}">${esc(r)}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F7F8FC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#182235;">
<table role="presentation" width="100%" style="max-width:420px;margin:24px auto;background:#FFFFFF;border:1px solid #D9DFEA;border-radius:10px;padding:24px;font-size:14px;">
<tr><td colspan="2" style="text-align:center;font-size:16px;font-weight:600;white-space:pre-line;">${esc(header.join('\n'))}</td></tr>
${opts.reprint ? '<tr><td colspan="2" style="text-align:center;color:#7A4700;">REPRINT</td></tr>' : ''}
${row(`Receipt ${order.order_number}`, String(order.business_date || '').slice(0, 10))}
${lines.map((l) => row(`${l.item_name} × ${new Money(l.quantity).format(3).replace(/\.?0+$/, '')}`, f(l.net_amount || l.line_total))).join('\n')}
${row('Subtotal', f(order.subtotal))}
${row('You saved', f(order.discount_amount))}
${row('Tax', f(order.tax_amount))}
${row('Total', f(new Money(order.total_amount).add(order.cash_rounding || '0')), true)}
${tenders.map((t) => row(t.tender_type, f(t.amount_tendered))).join('\n')}
${row('Change', f(order.change_due))}
<tr><td colspan="2" style="text-align:center;color:#46536B;padding-top:12px;white-space:pre-line;">${esc(footer.join('\n'))}</td></tr>
</table></body></html>`;
  return {
    text: text.join('\n'),
    html,
    email: { subject: `Your receipt ${order.order_number}`, html, text: text.join('\n') },
  };
}
