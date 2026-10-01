/**
 * Deterministic automation handlers (no external services, no AI). Each handler
 * reads current state, returns alerts for the notification inbox and, only where
 * its tier allows, performs bounded actions through the normal domain paths
 * (postJournal for A3 postings, plain inserts for A2 non-financial drafts).
 */
import crypto from 'node:crypto';
import type { DbClient } from '@omnysync/platform';
import { AccountingPurpose } from '@omnysync/contracts';
import { BankReconciliationEngine, Money } from '@omnysync/financial-engine';
import { auditLogger, outboxService } from '../context.js';
import { postJournal } from '../lib/posting.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { toIsoDate } from '../lib/validate.js';
import { bankGlLines } from '../routes/treasury.js';
import { addMonthsIso } from './schedule.js';
import { billSubscription } from '../routes/subscriptions.js';

export interface DetectedAlert {
  dedupe_key: string;
  category: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  body?: string;
  entity_type?: string;
  entity_id?: string | null;
  data?: Record<string, unknown>;
}

export interface JobContext {
  q: DbClient;
  orgId: string;
  rule: any;
  config: Record<string, any>;
  today: string;
  now: Date;
}

export interface JobResult {
  summary: Record<string, unknown>;
  alerts: DetectedAlert[];
  /** Open alerts whose dedupe_key starts with this prefix and were not re-detected are auto-resolved. */
  resolveScope?: string;
}

const f2 = (v: unknown) => new Money(String(v ?? '0')).toFixed(2);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const isoPlusDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- inventory
async function reorderAlerts({ q, orgId }: JobContext): Promise<JobResult> {
  const r = await q.query(
    `SELECT i.id, i.code, i.name, i.reorder_point::text, i.reorder_qty::text, COALESCE(SUM(sm.quantity),0)::text AS on_hand
     FROM items i LEFT JOIN stock_movements sm ON sm.item_id = i.id AND sm.organization_id = i.organization_id
     WHERE i.organization_id = $1 AND i.is_active = true AND i.item_type = 'INVENTORY' AND i.reorder_point > 0
     GROUP BY i.id HAVING COALESCE(SUM(sm.quantity),0) <= i.reorder_point ORDER BY i.code`,
    [orgId],
  );
  const alerts: DetectedAlert[] = r.rows.map((i: any) => {
    const onHand = new Money(i.on_hand);
    // Order up to (reorder point + reorder qty), never less than the configured reorder qty.
    const target = new Money(i.reorder_point).add(i.reorder_qty || '0');
    const proposed = Money.max(new Money(i.reorder_qty || '0'), target.sub(onHand)).round(3);
    return {
      dedupe_key: `REORDER:${i.id}`,
      category: 'INVENTORY',
      severity: onHand.isPositive() ? 'WARNING' : 'CRITICAL',
      title: `${i.code} ${i.name} at/below reorder point`,
      body: `On hand ${onHand.toFixed(3)} ≤ reorder point ${new Money(i.reorder_point).toFixed(3)}. Proposed order: ${proposed.toFixed(3)}.`,
      entity_type: 'ITEM',
      entity_id: i.id,
      data: { on_hand: onHand.toFixed(3), reorder_point: new Money(i.reorder_point).toFixed(3), proposed_qty: proposed.toFixed(3) },
    };
  });
  return { summary: { items_below_reorder_point: alerts.length }, alerts, resolveScope: 'REORDER:' };
}

async function stockGlRecon({ q, orgId, config }: JobContext): Promise<JobResult> {
  const tolerance = new Money(String(config.tolerance ?? '1.00'));
  const r = await q.query(
    `WITH inv AS (
       SELECT i.inventory_account_id AS account_id, COALESCE(SUM(sm.total_value),0) AS stock_value
       FROM items i JOIN stock_movements sm ON sm.item_id = i.id AND sm.organization_id = i.organization_id
       WHERE i.organization_id = $1 AND i.item_type = 'INVENTORY' AND i.inventory_account_id IS NOT NULL
       GROUP BY i.inventory_account_id)
     SELECT a.id, a.code, a.name, inv.stock_value::text,
       COALESCE((SELECT SUM(jl.base_debit - jl.base_credit) FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
                 WHERE jl.account_id = a.id AND j.organization_id = $1 AND j.status IN ('POSTED','REVERSED')),0)::text AS gl_balance
     FROM inv JOIN accounts a ON a.id = inv.account_id`,
    [orgId],
  );
  const alerts: DetectedAlert[] = [];
  const accounts = r.rows.map((a: any) => {
    const diff = new Money(a.gl_balance).sub(a.stock_value);
    if (diff.abs().gt(tolerance)) {
      alerts.push({
        dedupe_key: `STOCK_GL:${a.id}`,
        category: 'FINANCE',
        severity: 'CRITICAL',
        title: `Stock ledger ≠ GL for ${a.code} ${a.name}`,
        body: `Stock valuation ${f2(a.stock_value)} vs GL ${f2(a.gl_balance)} (difference ${f2(diff.toFixed(2))}). Investigate unposted or mis-posted inventory movements.`,
        entity_type: 'ACCOUNT',
        entity_id: a.id,
        data: { stock_value: f2(a.stock_value), gl_balance: f2(a.gl_balance), difference: diff.toFixed(2) },
      });
    }
    return { account: a.code, stock_value: f2(a.stock_value), gl_balance: f2(a.gl_balance), difference: diff.toFixed(2) };
  });
  return { summary: { accounts_checked: accounts.length, out_of_balance: alerts.length, accounts }, alerts, resolveScope: 'STOCK_GL:' };
}

// ---------------------------------------------------------------- receivables / payables
async function arDunning({ q, orgId, today }: JobContext): Promise<JobResult> {
  const r = await q.query(
    `SELECT a.id, a.invoice_number, a.due_date, a.outstanding_amount::text, p.name AS customer
     FROM ar_invoices a JOIN parties p ON p.id = a.party_id
     WHERE a.organization_id = $1 AND a.status IN ('POSTED','PARTIALLY_PAID') AND a.outstanding_amount > 0 AND a.due_date < $2::date
     ORDER BY a.due_date`,
    [orgId, today],
  );
  let total = Money.zero();
  const alerts: DetectedAlert[] = r.rows.map((a: any) => {
    const days = daysBetween(toIsoDate(a.due_date), today);
    const level = days > 60 ? 3 : days > 30 ? 2 : 1;
    total = total.add(a.outstanding_amount);
    return {
      dedupe_key: `AR_DUNNING:${a.id}`,
      category: 'RECEIVABLES',
      severity: level === 3 ? 'CRITICAL' : level === 2 ? 'WARNING' : 'INFO',
      title: `Dunning level ${level}: ${a.invoice_number} (${a.customer})`,
      body: `${f2(a.outstanding_amount)} overdue by ${days} day(s). ${level === 1 ? 'Send friendly reminder.' : level === 2 ? 'Send second notice; review credit.' : 'Final notice; consider credit hold.'}`,
      entity_type: 'AR_INVOICE',
      entity_id: a.id,
      data: { level, days_overdue: days, outstanding: f2(a.outstanding_amount), customer: a.customer },
    };
  });
  return { summary: { overdue_invoices: alerts.length, overdue_total: total.toFixed(2) }, alerts, resolveScope: 'AR_DUNNING:' };
}

async function apDueProposals({ q, orgId, today, config }: JobContext): Promise<JobResult> {
  const horizon = isoPlusDays(today, Number(config.days_ahead ?? 7));
  const r = await q.query(
    `SELECT a.id, a.invoice_number, a.due_date, a.outstanding_amount::text, p.name AS supplier
     FROM ap_invoices a JOIN parties p ON p.id = a.party_id
     WHERE a.organization_id = $1 AND a.status IN ('POSTED','PARTIALLY_PAID') AND a.outstanding_amount > 0 AND a.due_date <= $2::date
     ORDER BY a.due_date`,
    [orgId, horizon],
  );
  if (r.rows.length === 0) return { summary: { bills_due: 0 }, alerts: [], resolveScope: 'AP_DUE:' };
  const total = r.rows.reduce((s: Money, a: any) => s.add(a.outstanding_amount), Money.zero());
  const overdue = r.rows.filter((a: any) => toIsoDate(a.due_date) < today).length;
  return {
    summary: { bills_due: r.rows.length, total: total.toFixed(2), overdue },
    alerts: [
      {
        dedupe_key: `AP_DUE:${today}`,
        category: 'PAYABLES',
        severity: overdue > 0 ? 'WARNING' : 'INFO',
        title: `Payment proposal: ${r.rows.length} bill(s) due by ${horizon}`,
        body: `Total ${total.toFixed(2)}${overdue ? `, ${overdue} already overdue` : ''}. Proposal only: payment release stays a manual, approved action (tier A4 is never automated).`,
        data: { horizon, bills: r.rows.map((a: any) => ({ id: a.id, number: a.invoice_number, supplier: a.supplier, due: toIsoDate(a.due_date), amount: f2(a.outstanding_amount) })) },
      },
    ],
    resolveScope: 'AP_DUE:',
  };
}

// ---------------------------------------------------------------- finance
async function recurringJournals({ q, orgId, today, config }: JobContext): Promise<JobResult> {
  const maxCatchUp = Math.min(12, Number(config.max_catch_up ?? 3));
  const templates = await q.query(
    `SELECT * FROM recurring_journal_templates WHERE organization_id = $1 AND status = 'ACTIVE' AND approved_by IS NOT NULL AND next_run_date <= $2::date ORDER BY code FOR UPDATE`,
    [orgId, today],
  );
  const alerts: DetectedAlert[] = [];
  const posted: any[] = [];
  for (const t of templates.rows) {
    let next = toIsoDate(t.next_run_date);
    for (let i = 0; i < maxCatchUp && next <= today; i++) {
      if (t.end_date && next > toIsoDate(t.end_date)) break;
      if (t.max_amount && new Money(t.total_amount).gt(t.max_amount)) {
        alerts.push({ dedupe_key: `RECURRING_LIMIT:${t.id}`, category: 'FINANCE', severity: 'CRITICAL', title: `Recurring journal ${t.code} exceeds its approved limit`, body: 'Not posted. Re-approve the template.', entity_type: 'RECURRING_JOURNAL', entity_id: t.id });
        break;
      }
      const lines = (typeof t.lines === 'string' ? JSON.parse(t.lines) : t.lines) as any[];
      try {
        // Savepoint per occurrence: a closed period fails this occurrence only.
        const j = await q.transaction(async (tx) =>
          postJournal(tx, auditLogger, outboxService, {
            organizationId: orgId, legalEntityId: t.legal_entity_id, userId: t.created_by, postingDate: next, purpose: AccountingPurpose.RECURRING_JOURNAL,
            description: `${t.name} (${next})`, sourceType: 'RECURRING_JOURNAL', sourceId: t.id, sourceKey: `RECURRING:${t.id}:${next}`, numberPrefix: 'JV-REC',
            lines: lines.map((l) => ({ account_code: l.account_code, debit: l.debit || undefined, credit: l.credit || undefined, description: l.description || t.name })),
            approvedBy: t.approved_by,
          }),
        );
        posted.push({ template: t.code, date: next, journal: j?.journalNumber, replayed: j?.replayed });
        const following = addMonthsIso(next, 1, t.day_of_month);
        const ended = t.end_date && following > toIsoDate(t.end_date);
        await q.query(
          `UPDATE recurring_journal_templates SET next_run_date = $1, last_journal_id = $2, occurrences_posted = occurrences_posted + $3, status = $4 WHERE id = $5`,
          [following, j?.journalId || t.last_journal_id, j && !j.replayed ? 1 : 0, ended ? 'ENDED' : 'ACTIVE', t.id],
        );
        next = following;
        if (ended) break;
      } catch (e: any) {
        alerts.push({
          dedupe_key: `RECURRING_FAIL:${t.id}:${next}`, category: 'FINANCE', severity: 'CRITICAL', title: `Recurring journal ${t.code} could not post for ${next}`,
          body: String(e?.message || e), entity_type: 'RECURRING_JOURNAL', entity_id: t.id, data: { date: next },
        });
        break;
      }
    }
  }
  return { summary: { templates_due: templates.rows.length, posted }, alerts };
}

async function bankAutoMatch({ q, orgId, config }: JobContext): Promise<JobResult> {
  const tolerance = Math.min(31, Number(config.date_tolerance_days ?? 5));
  const autoApply = config.auto_apply !== false;
  const statements = await q.query(`SELECT * FROM bank_statements WHERE organization_id = $1 AND status <> 'RECONCILED' ORDER BY statement_date`, [orgId]);
  const alerts: DetectedAlert[] = [];
  let matchedTotal = 0;
  for (const st of statements.rows) {
    const lines = (await q.query(`SELECT * FROM bank_statement_lines WHERE statement_id = $1 AND is_matched = false ORDER BY line_number`, [st.id])).rows;
    if (lines.length === 0) continue;
    const gl = (await bankGlLines(q, orgId, st.bank_account_id, toIsoDate(st.statement_date))).filter((l: any) => !l.matched_statement_line_id);
    const suggestions = BankReconciliationEngine.suggestMatches(
      lines.map((l: any) => ({ id: l.id, date: toIsoDate(l.transaction_date), amount: l.amount, reference: l.reference || '', description: l.description || '' })),
      gl.map((g: any) => ({ id: g.id, date: toIsoDate(g.posting_date), amount: new Money(g.base_debit).sub(g.base_credit).toFixed(8), text: `${g.journal_number} ${g.journal_description || ''} ${g.description || ''}` })),
      tolerance,
    );
    if (autoApply) {
      // Tier A2: matching is reversible (unmatch) and sign-off stays a separate human step.
      for (const m of suggestions) await q.query(`UPDATE bank_statement_lines SET is_matched = true, matched_journal_line_id = $1 WHERE id = $2 AND is_matched = false`, [m.journalLineId, m.statementLineId]);
      if (suggestions.length) await q.query(`UPDATE bank_statements SET status = 'RECONCILING', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'UPLOADED'`, [st.id]);
    }
    matchedTotal += suggestions.length;
    const remaining = lines.length - (autoApply ? suggestions.length : 0);
    if (remaining > 0 || !autoApply) {
      alerts.push({
        dedupe_key: `BANK_UNMATCHED:${st.id}`, category: 'TREASURY', severity: 'WARNING',
        title: `Bank statement ${toIsoDate(st.statement_date)}: ${remaining} line(s) need review`,
        body: autoApply ? `${suggestions.length} line(s) auto-matched (exact amount, date ±${tolerance}d, unique). Review the rest, then sign off.` : `${suggestions.length} match suggestion(s) ready for review.`,
        entity_type: 'BANK_STATEMENT', entity_id: st.id, data: { suggested: suggestions.length, remaining },
      });
    }
  }
  return { summary: { statements: statements.rows.length, matched: matchedTotal, auto_apply: autoApply }, alerts, resolveScope: 'BANK_UNMATCHED:' };
}

async function depreciationDue({ q, orgId, today }: JobContext): Promise<JobResult> {
  const r = await q.query(
    `SELECT fp.id, fp.period_name, fp.end_date,
       (SELECT COUNT(*)::int FROM fixed_assets fa WHERE fa.organization_id = $1 AND fa.status = 'ACTIVE' AND fa.acquisition_date <= fp.end_date
          AND NOT EXISTS (SELECT 1 FROM asset_depreciation_entries d WHERE d.asset_id = fa.id AND d.period_id = fp.id)) AS pending
     FROM fiscal_periods fp JOIN legal_entities le ON le.id = fp.legal_entity_id
     WHERE le.organization_id = $1 AND fp.end_date < $2::date AND fp.status = 'OPEN'
     ORDER BY fp.end_date DESC LIMIT 3`,
    [orgId, today],
  );
  const alerts: DetectedAlert[] = r.rows.filter((p: any) => p.pending > 0).map((p: any) => ({
    dedupe_key: `DEPRECIATION:${p.id}`, category: 'ASSETS', severity: 'WARNING',
    title: `Depreciation not run for ${p.period_name}`, body: `${p.pending} active asset(s) have no depreciation entry for the period ending ${toIsoDate(p.end_date)}. Run the depreciation batch before closing.`,
    entity_type: 'FISCAL_PERIOD', entity_id: p.id, data: { pending_assets: p.pending },
  }));
  return { summary: { periods_checked: r.rows.length, periods_pending: alerts.length }, alerts, resolveScope: 'DEPRECIATION:' };
}

async function periodCloseReminder({ q, orgId, today, config }: JobContext): Promise<JobResult> {
  const lead = Number(config.days_before_end ?? 3);
  const r = await q.query(
    `SELECT fp.id, fp.period_name, fp.start_date, fp.end_date, fp.status FROM fiscal_periods fp JOIN legal_entities le ON le.id = fp.legal_entity_id
     WHERE le.organization_id = $1 AND fp.status = 'OPEN' AND fp.end_date <= $2::date ORDER BY fp.end_date`,
    [orgId, isoPlusDays(today, lead)],
  );
  const alerts: DetectedAlert[] = r.rows.map((p: any) => {
    const end = toIsoDate(p.end_date);
    const late = end < today;
    return {
      dedupe_key: `PERIOD_CLOSE:${p.id}`, category: 'FINANCE', severity: late && daysBetween(end, today) > 10 ? 'CRITICAL' : late ? 'WARNING' : 'INFO',
      title: late ? `${p.period_name} ended ${daysBetween(end, today)} day(s) ago and is still open` : `${p.period_name} closes on ${end}`,
      body: 'Close checklist: bank reconciliations signed off, depreciation run, accruals and recurring journals posted, stock-to-GL reconciled, then soft-close.',
      entity_type: 'FISCAL_PERIOD', entity_id: p.id,
    };
  });
  return { summary: { periods: alerts.length }, alerts, resolveScope: 'PERIOD_CLOSE:' };
}

async function approvalAging({ q, orgId, today, config }: JobContext): Promise<JobResult> {
  const days = Number(config.max_age_days ?? 2);
  const cutoff = isoPlusDays(today, -days);
  const j = await q.query(`SELECT id, journal_number, created_at FROM journals WHERE organization_id = $1 AND status = 'SUBMITTED' AND created_at::date <= $2::date`, [orgId, cutoff]);
  const po = await q.query(`SELECT id, po_number, created_at FROM purchase_orders WHERE organization_id = $1 AND status = 'DRAFT' AND created_at::date <= $2::date`, [orgId, cutoff]);
  const alerts: DetectedAlert[] = [
    ...j.rows.map((r: any) => ({ dedupe_key: `APPROVAL:JOURNAL:${r.id}`, category: 'APPROVALS', severity: 'WARNING' as const, title: `Journal ${r.journal_number} awaiting approval > ${days} day(s)`, entity_type: 'JOURNAL', entity_id: r.id })),
    ...po.rows.map((r: any) => ({ dedupe_key: `APPROVAL:PO:${r.id}`, category: 'APPROVALS', severity: 'INFO' as const, title: `Purchase order ${r.po_number} still in draft > ${days} day(s)`, entity_type: 'PURCHASE_ORDER', entity_id: r.id })),
  ];
  return { summary: { journals: j.rows.length, purchase_orders: po.rows.length }, alerts, resolveScope: 'APPROVAL:' };
}

// ---------------------------------------------------------------- operations
async function pmWorkOrders({ q, orgId, today, config }: JobContext): Promise<JobResult> {
  const lead = Number(config.lead_days ?? 3);
  const due = await q.query(
    `SELECT s.*, e.legal_entity_id, e.name AS equipment_name FROM pm_schedules s JOIN maintenance_equipment e ON e.id = s.equipment_id
     WHERE s.organization_id = $1 AND s.status = 'ACTIVE' AND s.next_due_date <= $2::date
       AND NOT EXISTS (SELECT 1 FROM maintenance_work_orders w WHERE w.pm_schedule_id = s.id AND w.status NOT IN ('COMPLETED','CANCELLED'))
     ORDER BY s.next_due_date FOR UPDATE OF s`,
    [orgId, isoPlusDays(today, lead)],
  );
  const created: any[] = [];
  const alerts: DetectedAlert[] = [];
  for (const s of due.rows) {
    const id = crypto.randomUUID();
    const number = await nextDocumentNumber(q, orgId, 'PM-WO', today, 5);
    // Tier A2: a SCHEDULED draft work order, reversible (cancel) and non-financial.
    await q.query(
      `INSERT INTO maintenance_work_orders (id, organization_id, legal_entity_id, work_order_number, equipment_id, pm_schedule_id, order_type, priority, status, description, start_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'PREVENTIVE','MEDIUM','SCHEDULED',$7,$8,NULL)`,
      [id, orgId, s.legal_entity_id, number, s.equipment_id, s.id, `Preventive maintenance: ${s.schedule_name} (auto-generated, due ${toIsoDate(s.next_due_date)})`, toIsoDate(s.next_due_date)],
    );
    created.push({ work_order: number, schedule: s.schedule_name, due: toIsoDate(s.next_due_date) });
    alerts.push({
      dedupe_key: `PM_WO:${s.id}:${toIsoDate(s.next_due_date)}`, category: 'MAINTENANCE', severity: toIsoDate(s.next_due_date) < today ? 'WARNING' : 'INFO',
      title: `Work order ${number} scheduled: ${s.schedule_name}`, body: `${s.equipment_name}, due ${toIsoDate(s.next_due_date)}.`, entity_type: 'MAINT_WORK_ORDER', entity_id: id,
    });
  }
  return { summary: { schedules_due: due.rows.length, created }, alerts };
}

async function posShiftMonitor({ q, orgId, now, config }: JobContext): Promise<JobResult> {
  const maxHours = Number(config.max_shift_hours ?? 14);
  const open = await q.query(
    `SELECT s.id, s.cashier_name, s.opened_at, r.register_code FROM pos_sessions s JOIN pos_registers r ON r.id = s.register_id
     WHERE s.organization_id = $1 AND s.status = 'OPEN' AND s.opened_at < $2`,
    [orgId, new Date(now.getTime() - maxHours * 3600000).toISOString()],
  );
  const variance = await q.query(
    `SELECT s.id, s.cashier_name, s.cash_difference::text, s.z_number, r.register_code FROM pos_sessions s JOIN pos_registers r ON r.id = s.register_id
     WHERE s.organization_id = $1 AND s.status = 'CLOSED' AND s.cash_difference <> 0 AND s.closed_at > $2`,
    [orgId, new Date(now.getTime() - 7 * 86400000).toISOString()],
  );
  const alerts: DetectedAlert[] = [
    ...open.rows.map((s: any) => ({ dedupe_key: `POS_OPEN:${s.id}`, category: 'POS', severity: 'WARNING' as const, title: `${s.register_code}: shift open more than ${maxHours}h (${s.cashier_name})`, body: 'Close the shift with a blind count so cash is accounted for.', entity_type: 'POS_SESSION', entity_id: s.id })),
    ...variance.rows.map((s: any) => ({
      dedupe_key: `POS_VARIANCE:${s.id}`, category: 'POS', severity: new Money(s.cash_difference).abs().gt(String(config.material_variance ?? '500')) ? ('CRITICAL' as const) : ('INFO' as const),
      title: `${s.register_code} Z#${s.z_number}: cash ${new Money(s.cash_difference).isNegative() ? 'short' : 'over'} ${new Money(s.cash_difference).abs().toFixed(2)}`, body: `Cashier ${s.cashier_name}. Review the variance notes and audit trail.`, entity_type: 'POS_SESSION', entity_id: s.id,
    })),
  ];
  return { summary: { long_open_shifts: open.rows.length, variances_7d: variance.rows.length }, alerts, resolveScope: 'POS_OPEN:' };
}

// ---------------------------------------------------------------- service (SRV)
async function serviceSlaPm({ q, orgId, today, now, config }: JobContext): Promise<JobResult> {
  const { generatePreventive } = await import('../routes/service.js');
  const le = (await q.query(`SELECT id FROM legal_entities WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [orgId])).rows[0]?.id;
  const pm = le ? await generatePreventive(q, orgId, le, null, today) : { created: [], skipped_duplicates: 0 };
  const riskMin = Number(config.at_risk_minutes ?? 60);
  const open = await q.query(
    `SELECT c.id, c.number, c.title, c.priority, c.resolution_due_at + (c.paused_minutes || ' minutes')::interval AS due, p.name AS party
     FROM srv_cases c JOIN parties p ON p.id = c.party_id
     WHERE c.organization_id = $1 AND c.status NOT IN ('RESOLVED','CLOSED','CANCELLED','ON_HOLD') AND c.resolution_due_at IS NOT NULL
       AND c.resolution_due_at + (c.paused_minutes || ' minutes')::interval < $2`,
    [orgId, new Date(now.getTime() + riskMin * 60000).toISOString()],
  );
  const alerts: DetectedAlert[] = open.rows.map((c: any) => {
    const breached = new Date(c.due) <= now;
    return {
      dedupe_key: `SRV_SLA:${c.id}:${breached ? 'BREACH' : 'RISK'}`, category: 'SERVICE', severity: breached ? 'CRITICAL' : 'WARNING',
      title: `${c.number} ${breached ? 'breached' : 'at risk of breaching'} its resolution SLA (${c.priority})`,
      body: `${c.party}: ${c.title}. Due ${new Date(c.due).toISOString()}.`, entity_type: 'SERVICE_CASE', entity_id: c.id,
    };
  });
  for (const n of pm.created) alerts.push({ dedupe_key: `SRV_PM:${n}`, category: 'SERVICE', severity: 'INFO', title: `Preventive case ${n} created`, entity_type: 'SERVICE_CASE' });
  return { summary: { pm_cases_created: pm.created, pm_duplicates_skipped: pm.skipped_duplicates, sla_alerts: open.rows.length }, alerts, resolveScope: 'SRV_SLA:' };
}


/** A3: bills due AMC / subscription periods (subscriptions were activated by a person; billing is idempotent per period). */
async function subscriptionBilling({ q, orgId, today, config, rule }: JobContext): Promise<JobResult> {
  const due = (await q.query(`SELECT id, number, legal_entity_id, created_by FROM com_subscriptions WHERE organization_id = $1 AND status = 'ACTIVE' AND next_bill_date IS NOT NULL AND next_bill_date <= $2::date ORDER BY number`, [orgId, today])).rows;
  const alerts: DetectedAlert[] = [];
  let invoices = 0;
  const billed: any[] = [];
  for (const s of due) {
    try {
      const r: any = await q.transaction((tx) =>
        billSubscription({ req: { correlationId: crypto.randomUUID() } as any, tx, org: orgId, le: s.legal_entity_id, user: s.created_by }, s.id, today, Math.min(12, Number(config.max_periods ?? 3))),
      );
      invoices += r.invoices?.length || 0;
      billed.push({ subscription: s.number, invoices: r.invoices, next_bill_date: r.next_bill_date, ended: r.ended });
    } catch (e: any) {
      alerts.push({ dedupe_key: `COM_BILLING_FAIL:${s.id}`, category: 'FINANCE', severity: 'CRITICAL', title: `Subscription ${s.number} could not be billed`, body: String(e?.message || e), entity_type: 'SUBSCRIPTION', entity_id: s.id });
    }
  }
  return { summary: { due: due.length, invoices, billed, rule: rule?.code }, alerts, resolveScope: 'COM_BILLING_FAIL:' };
}

export const JOB_HANDLERS: Record<string, (ctx: JobContext) => Promise<JobResult>> = {
  REORDER_ALERTS: reorderAlerts,
  STOCK_GL_RECON: stockGlRecon,
  AR_DUNNING: arDunning,
  AP_DUE_PROPOSALS: apDueProposals,
  RECURRING_JOURNALS: recurringJournals,
  BANK_AUTO_MATCH: bankAutoMatch,
  DEPRECIATION_DUE: depreciationDue,
  PERIOD_CLOSE_REMINDER: periodCloseReminder,
  APPROVAL_AGING: approvalAging,
  PM_WORK_ORDERS: pmWorkOrders,
  POS_SHIFT_MONITOR: posShiftMonitor,
  SERVICE_SLA_PM: serviceSlaPm,
  SUBSCRIPTION_BILLING: subscriptionBilling,
};

/** Default rule catalogue, created idempotently for every organisation. */
export const DEFAULT_RULES: { code: string; name: string; job_type: string; tier: string; schedule_kind: 'INTERVAL' | 'DAILY' | 'MONTHLY'; interval_minutes?: number; run_at_local?: string; owner_role: string; description: string; config?: Record<string, unknown> }[] = [
  { code: 'INV-REORDER', name: 'Reorder point alerts', job_type: 'REORDER_ALERTS', tier: 'A0', schedule_kind: 'INTERVAL', interval_minutes: 60, owner_role: 'STORE_MANAGER', description: 'Flags stocked items at or below their reorder point with a proposed order quantity.' },
  { code: 'INV-STOCK-GL', name: 'Stock ledger vs GL reconciliation', job_type: 'STOCK_GL_RECON', tier: 'A0', schedule_kind: 'DAILY', run_at_local: '05:30', owner_role: 'CONTROLLER', description: 'Compares perpetual stock valuation with inventory GL balances.', config: { tolerance: '1.00' } },
  { code: 'AR-DUNNING', name: 'AR overdue dunning', job_type: 'AR_DUNNING', tier: 'A0', schedule_kind: 'DAILY', run_at_local: '08:00', owner_role: 'ACCOUNTANT', description: 'Levels overdue customer invoices (1–30, 31–60, 60+ days) for reminders.' },
  { code: 'AP-DUE', name: 'AP payment proposal', job_type: 'AP_DUE_PROPOSALS', tier: 'A0', schedule_kind: 'DAILY', run_at_local: '08:30', owner_role: 'ACCOUNTANT', description: 'Lists supplier bills due within the horizon. Never releases payments.', config: { days_ahead: 7 } },
  { code: 'GL-RECURRING', name: 'Recurring journals', job_type: 'RECURRING_JOURNALS', tier: 'A3', schedule_kind: 'DAILY', run_at_local: '02:00', owner_role: 'CONTROLLER', description: 'Posts approved recurring journal templates on their due date (idempotent per occurrence).', config: { max_catch_up: 3 } },
  { code: 'BANK-AUTOMATCH', name: 'Bank statement auto-match', job_type: 'BANK_AUTO_MATCH', tier: 'A2', schedule_kind: 'INTERVAL', interval_minutes: 120, owner_role: 'ACCOUNTANT', description: 'Matches statement lines to GL cash lines (exact amount, date tolerance, unique). Sign-off remains manual.', config: { date_tolerance_days: 5, auto_apply: true } },
  { code: 'FA-DEPRECIATION', name: 'Depreciation due check', job_type: 'DEPRECIATION_DUE', tier: 'A0', schedule_kind: 'DAILY', run_at_local: '07:00', owner_role: 'CONTROLLER', description: 'Warns when ended open periods lack depreciation entries.' },
  { code: 'GL-CLOSE', name: 'Period close reminders', job_type: 'PERIOD_CLOSE_REMINDER', tier: 'A0', schedule_kind: 'DAILY', run_at_local: '09:00', owner_role: 'CONTROLLER', description: 'Reminds before period end and escalates periods left open.', config: { days_before_end: 3 } },
  { code: 'WF-APPROVAL-AGING', name: 'Approval queue aging', job_type: 'APPROVAL_AGING', tier: 'A0', schedule_kind: 'DAILY', run_at_local: '09:30', owner_role: 'CONTROLLER', description: 'Escalates journals and purchase orders waiting too long.', config: { max_age_days: 2 } },
  { code: 'PM-WORKORDERS', name: 'Preventive maintenance work orders', job_type: 'PM_WORK_ORDERS', tier: 'A2', schedule_kind: 'DAILY', run_at_local: '06:00', owner_role: 'ADMIN', description: 'Creates scheduled work orders for PM plans falling due.', config: { lead_days: 3 } },
  { code: 'POS-MONITOR', name: 'POS shift monitor', job_type: 'POS_SHIFT_MONITOR', tier: 'A0', schedule_kind: 'INTERVAL', interval_minutes: 30, owner_role: 'STORE_MANAGER', description: 'Flags shifts left open too long and recent cash variances.', config: { max_shift_hours: 14, material_variance: '500' } },
  { code: 'SRV-SLA-PM', name: 'Service SLA escalation & preventive visits', job_type: 'SERVICE_SLA_PM', tier: 'A2', schedule_kind: 'INTERVAL', interval_minutes: 15, owner_role: 'SERVICE_MANAGER', description: 'Escalates service cases at risk of / past their SLA and opens preventive-maintenance cases for contracts falling due (one per occurrence).', config: { at_risk_minutes: 60 } },
  { code: 'COM-BILLING', name: 'Subscription / AMC billing', job_type: 'SUBSCRIPTION_BILLING', tier: 'A3', schedule_kind: 'DAILY', run_at_local: '03:00', owner_role: 'ACCOUNTANT', description: 'Invoices active subscriptions on their bill date (in advance, one invoice per period, period-guarded). Failures alert the owner.', config: { max_periods: 3 } },
];
