/**
 * CRM — lead capture with duplicate detection, qualification, conversion to a customer and an
 * opportunity, staged pipeline with weighted forecast, won/lost (loss reason mandatory), and
 * activities. Winning emits CRM_OPPORTUNITY_WIN (amount, name) for event-triggered automation and
 * can open an INSTALLATION service case so sales hands over to field service without re-keying.
 */
import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { Permission, ErrorCode } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, loadRow, type Ctx } from '../lib/resource.js';
import { nextDocumentNumber } from '../lib/numbering.js';

const VIEW = [Permission.CRM_VIEW, Permission.CRM_MANAGE];
export const STAGES = ['PROSPECTING', 'QUALIFICATION', 'SITE_SURVEY', 'PROPOSAL', 'NEGOTIATION'] as const;
export const STAGE_PROBABILITY: Record<string, number> = { PROSPECTING: 10, QUALIFICATION: 25, SITE_SURVEY: 40, PROPOSAL: 60, NEGOTIATION: 80, WON: 100, LOST: 0 };

export const normEmail = (e?: string | null) => (e ? e.trim().toLowerCase() : null);
/** Pakistani numbers: +92 / 0092 / 0 prefixes collapse to the same 10-digit subscriber number. */
export function normPhone(p?: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(4);
  else if (d.startsWith('92') && d.length === 12) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.length >= 7 ? d : null;
}

/** Weighted forecast = Σ amount × probability (exact decimals). */
export function weightedForecast(rows: { amount: string; probability: number }[]): string {
  return rows.reduce((a, r) => a.add(new Money(r.amount).mul(r.probability).div(100)), Money.zero()).round(2).toFixed(2);
}

async function findDuplicate(ctx: Ctx, email: string | null, phone: string | null, excludeId?: string) {
  if (!email && !phone) return null;
  const r = await ctx.tx.query(
    `SELECT id, number, name, status FROM crm_leads WHERE organization_id = $1 AND status <> 'DISQUALIFIED' AND ($4::uuid IS NULL OR id <> $4)
       AND ((email_norm IS NOT NULL AND email_norm = $2) OR (phone_norm IS NOT NULL AND phone_norm = $3)) LIMIT 1`,
    [ctx.org, email, phone, excludeId ?? null],
  );
  return r.rows[0] || null;
}

export function registerCrmRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/crm/leads',
    table: 'crm_leads',
    label: 'Lead',
    event: 'CRM_LEAD',
    module: 'CRM',
    view: VIEW,
    create: Permission.CRM_MANAGE,
    update: Permission.CRM_MANAGE,
    fields: {
      name: { type: 'string', required: true },
      company: { type: 'string' },
      email: { type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      phone: { type: 'string', max: 40 },
      source: { type: 'enum', values: ['WEBSITE', 'REFERRAL', 'WALK_IN', 'PHONE', 'SOCIAL', 'PARTNER', 'EVENT', 'OTHER'], default: 'WEBSITE' },
      interest: { type: 'text' },
      city: { type: 'string', max: 80 },
      estimated_value: { type: 'decimal', default: '0', scale: 2 },
    },
    editable: ['name', 'company', 'email', 'phone', 'interest', 'city', 'estimated_value'],
    editableIn: ['NEW', 'CONTACTED', 'QUALIFIED'],
    numbering: { column: 'number', prefix: 'LEAD' },
    initialStatus: 'NEW',
    search: ['number', 'name', 'company', 'email', 'phone', 'city'],
    filters: ['source'],
    beforeCreate: async (ctx, v) => {
      v.email_norm = normEmail(v.email);
      v.phone_norm = normPhone(v.phone);
      if (!v.email_norm && !v.phone_norm) throw validationError('Provide an email or a phone number so the lead can be contacted', { field: 'email' });
      const dup = await findDuplicate(ctx, v.email_norm, v.phone_norm);
      if (dup && !ctx.req.body?.allow_duplicate) {
        throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Possible duplicate of ${dup.number} (${dup.name}, ${dup.status})`, { existing_id: dup.id, existing_number: dup.number });
      }
      v.owner_user_id = ctx.user;
    },
    beforeUpdate: async (ctx, row, v) => {
      if (v.email !== undefined) v.email_norm = normEmail(v.email);
      if (v.phone !== undefined) v.phone_norm = normPhone(v.phone);
      const dup = await findDuplicate(ctx, v.email_norm ?? row.email_norm, v.phone_norm ?? row.phone_norm, row.id);
      if (dup) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Would duplicate ${dup.number} (${dup.name})`, { existing_id: dup.id });
    },
    commands: {
      contact: { from: ['NEW'], to: 'CONTACTED', permission: Permission.CRM_MANAGE },
      qualify: { from: ['NEW', 'CONTACTED'], to: 'QUALIFIED', permission: Permission.CRM_MANAGE },
      disqualify: { from: ['NEW', 'CONTACTED', 'QUALIFIED'], to: 'DISQUALIFIED', permission: Permission.CRM_MANAGE, fields: { disqualify_reason: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { disqualify_reason: i.disqualify_reason } }) },
      // Conversion is atomic: customer (reused when email/phone match an existing party) + opportunity.
      convert: {
        from: ['QUALIFIED'],
        to: 'CONVERTED',
        permission: Permission.CRM_MANAGE,
        fields: { opportunity_name: { type: 'string', required: true }, amount: { type: 'decimal', scale: 2 }, expected_close_date: { type: 'date' }, party_id: { type: 'ref', table: 'parties', label: 'party_id' } },
        run: async (ctx, lead, i) => {
          let partyId = i.party_id as string | null;
          let reused = !!partyId;
          if (!partyId) {
            const match = await ctx.tx.query(
              `SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') AND ((email IS NOT NULL AND lower(email) = $2) OR (phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $3)) LIMIT 1`,
              [ctx.org, lead.email_norm, lead.phone_norm || '__none__'],
            );
            partyId = match.rows[0]?.id ?? null;
            reused = !!partyId;
          }
          if (!partyId) {
            partyId = crypto.randomUUID();
            const code = await nextDocumentNumber(ctx.tx, ctx.org, 'CUST');
            await ctx.tx.query(`INSERT INTO parties (id, organization_id, legal_entity_id, code, name, party_type, email, phone, address) VALUES ($1,$2,$3,$4,$5,'CUSTOMER',$6,$7,$8)`, [
              partyId, ctx.org, ctx.le, code, lead.company || lead.name, lead.email, lead.phone, lead.city,
            ]);
          }
          const oppId = crypto.randomUUID();
          const num = await nextDocumentNumber(ctx.tx, ctx.org, 'OPP');
          await ctx.tx.query(
            `INSERT INTO crm_opportunities (id, organization_id, legal_entity_id, number, name, party_id, lead_id, amount, stage, probability, expected_close_date, owner_user_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'QUALIFICATION',25,$9,$10,$10)`,
            [oppId, ctx.org, ctx.le, num, i.opportunity_name, partyId, lead.id, i.amount || lead.estimated_value || '0', i.expected_close_date || null, ctx.user],
          );
          await ctx.tx.query(`UPDATE crm_activities SET party_id = COALESCE(party_id, $2), opportunity_id = COALESCE(opportunity_id, $3) WHERE lead_id = $1`, [lead.id, partyId, oppId]);
          return { set: { party_id: partyId, opportunity_id: oppId }, data: { party_id: partyId, customer_reused: reused, opportunity_id: oppId, opportunity_number: num } };
        },
      },
    },
  });

  defineResource(app, {
    path: '/api/crm/opportunities',
    table: 'crm_opportunities',
    label: 'Opportunity',
    event: 'CRM_OPPORTUNITY',
    module: 'CRM',
    view: VIEW,
    create: Permission.CRM_MANAGE,
    update: Permission.CRM_MANAGE,
    fields: {
      name: { type: 'string', required: true },
      party_id: { type: 'ref', table: 'parties', required: true, label: 'party_id' },
      amount: { type: 'decimal', default: '0', scale: 2 },
      expected_close_date: { type: 'date' },
    },
    editable: ['name', 'amount', 'expected_close_date'],
    editableIn: ['OPEN'],
    numbering: { column: 'number', prefix: 'OPP' },
    initialStatus: 'OPEN',
    select: `t.*, p.name AS party_name, ROUND(t.amount * t.probability / 100, 2) AS weighted_amount,
      (SELECT COUNT(*)::int FROM crm_activities a WHERE a.opportunity_id = t.id AND a.status = 'OPEN') AS open_activities`,
    joins: 'JOIN parties p ON p.id = t.party_id',
    search: ['number', 'name', 'p.name'],
    filters: ['stage', 'party_id'],
    orderBy: 't.expected_close_date NULLS LAST, t.created_at DESC',
    beforeCreate: async (ctx, v) => {
      v.owner_user_id = ctx.user;
    },
    detail: async (q, row) => ({
      activities: (await q.query(`SELECT * FROM crm_activities WHERE opportunity_id = $1 ORDER BY COALESCE(due_at, created_at) DESC`, [row.id])).rows,
    }),
    commands: {
      stage: {
        from: ['OPEN'],
        permission: Permission.CRM_MANAGE,
        fields: { stage: { type: 'enum', values: STAGES, required: true }, probability: { type: 'int', min: 1, max: 99 } },
        run: async (_c, row, i) => {
          if (i.stage === row.stage && !i.probability) throw new ApiError(409, ErrorCode.INVALID_STATE, `Already in ${row.stage}`);
          return { set: { stage: i.stage, probability: i.probability ?? STAGE_PROBABILITY[i.stage] } };
        },
      },
      win: {
        from: ['OPEN'],
        to: 'WON',
        permission: Permission.CRM_MANAGE,
        fields: { create_install_case: { type: 'bool' }, site_address: { type: 'text' } },
        run: async (ctx, row, i) => {
          if (!new Money(row.amount).isPositive()) throw validationError('Set the deal amount before marking it won', { field: 'amount' });
          const set: Record<string, unknown> = { stage: 'WON', probability: 100, closed_at: new Date().toISOString() };
          let caseNumber: string | null = null;
          if (i.create_install_case) {
            const id = crypto.randomUUID();
            caseNumber = await nextDocumentNumber(ctx.tx, ctx.org, 'SRV');
            await ctx.tx.query(
              `INSERT INTO srv_cases (id, organization_id, legal_entity_id, number, party_id, channel, title, category, priority, site_address, status, created_by)
               VALUES ($1,$2,$3,$4,$5,'PORTAL',$6,'INSTALLATION','MEDIUM',$7,'NEW',$8)`,
              [id, ctx.org, ctx.le, caseNumber, row.party_id, `Installation — ${row.name}`, i.site_address || null, ctx.user],
            );
            set.service_case_id = id;
          }
          return { set, data: { service_case_number: caseNumber } };
        },
      },
      lose: {
        from: ['OPEN'],
        to: 'LOST',
        permission: Permission.CRM_MANAGE,
        fields: { lost_reason: { type: 'enum', values: ['PRICE', 'COMPETITOR', 'NO_BUDGET', 'TIMING', 'NO_RESPONSE', 'SCOPE', 'OTHER'], required: true }, lost_notes: { type: 'text' } },
        run: async (_c, _r, i) => {
          if (i.lost_reason === 'OTHER' && !i.lost_notes) throw validationError('Explain the loss when the reason is OTHER', { field: 'lost_notes' });
          return { set: { stage: 'LOST', probability: 0, lost_reason: i.lost_reason, lost_notes: i.lost_notes, closed_at: new Date().toISOString() } };
        },
      },
      reopen: { from: ['LOST'], to: 'OPEN', permission: Permission.CRM_MANAGE, run: async () => ({ set: { stage: 'QUALIFICATION', probability: 25, lost_reason: null, lost_notes: null, closed_at: null } }) },
    },
  });

  defineResource(app, {
    path: '/api/crm/activities',
    table: 'crm_activities',
    label: 'Activity',
    event: 'CRM_ACTIVITY',
    module: 'CRM',
    view: VIEW,
    create: Permission.CRM_MANAGE,
    update: Permission.CRM_MANAGE,
    fields: {
      activity_type: { type: 'enum', values: ['CALL', 'MEETING', 'EMAIL', 'SITE_VISIT', 'TASK', 'WHATSAPP'], required: true },
      subject: { type: 'string', required: true },
      notes: { type: 'text' },
      due_at: { type: 'datetime' },
      lead_id: { type: 'ref', table: 'crm_leads', label: 'lead_id' },
      opportunity_id: { type: 'ref', table: 'crm_opportunities', label: 'opportunity_id' },
      party_id: { type: 'ref', table: 'parties', label: 'party_id' },
    },
    editable: ['subject', 'notes', 'due_at'],
    editableIn: ['OPEN'],
    initialStatus: 'OPEN',
    select: `t.*, l.name AS lead_name, o.number AS opportunity_number, o.name AS opportunity_name, p.name AS party_name,
      (t.status = 'OPEN' AND t.due_at < NOW()) AS overdue`,
    joins: 'LEFT JOIN crm_leads l ON l.id = t.lead_id LEFT JOIN crm_opportunities o ON o.id = t.opportunity_id LEFT JOIN parties p ON p.id = t.party_id',
    search: ['subject', 'l.name', 'o.name', 'p.name'],
    filters: ['activity_type', 'lead_id', 'opportunity_id'],
    orderBy: `t.status = 'OPEN' DESC, t.due_at NULLS LAST`,
    beforeCreate: async (ctx, v) => {
      if (!v.lead_id && !v.opportunity_id && !v.party_id) throw validationError('Link the activity to a lead, opportunity or customer', { field: 'lead_id' });
      if (v.opportunity_id) {
        const o = await loadRow(ctx.tx, 'crm_opportunities', v.opportunity_id, ctx.org, 'Opportunity');
        v.party_id = v.party_id || o.party_id;
      }
    },
    commands: {
      complete: { from: ['OPEN'], to: 'DONE', permission: Permission.CRM_MANAGE, fields: { outcome: { type: 'text', required: true } }, run: async (_c, _r, i) => ({ set: { outcome: i.outcome, completed_at: new Date().toISOString() } }) },
      cancel: { from: ['OPEN'], to: 'CANCELLED', permission: Permission.CRM_MANAGE },
    },
  });

  app.get('/api/crm/summary', authenticate, requireAnyPermission(...VIEW), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const open = (await db.query(`SELECT stage, amount::text, probability FROM crm_opportunities WHERE organization_id = $1 AND status = 'OPEN'`, [org])).rows;
    const byStage = STAGES.map((s) => {
      const rows = open.filter((o: any) => o.stage === s);
      return { stage: s, count: rows.length, amount: rows.reduce((a: Money, r: any) => a.add(r.amount), Money.zero()).toFixed(2), weighted: weightedForecast(rows) };
    });
    const closed = (await db.query(`SELECT COUNT(*) FILTER (WHERE status='WON')::int won, COUNT(*) FILTER (WHERE status='LOST')::int lost, COALESCE(SUM(amount) FILTER (WHERE status='WON' AND closed_at >= date_trunc('month', NOW())),0)::text won_mtd FROM crm_opportunities WHERE organization_id = $1`, [org])).rows[0];
    const leads = (await db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('NEW','CONTACTED','QUALIFIED'))::int open, COUNT(*) FILTER (WHERE status='CONVERTED')::int converted, COUNT(*)::int total FROM crm_leads WHERE organization_id = $1`, [org])).rows[0];
    const overdue = (await db.query(`SELECT COUNT(*)::int n FROM crm_activities WHERE organization_id = $1 AND status = 'OPEN' AND due_at < NOW()`, [org])).rows[0].n;
    const lossReasons = (await db.query(`SELECT lost_reason, COUNT(*)::int n FROM crm_opportunities WHERE organization_id = $1 AND status = 'LOST' GROUP BY lost_reason ORDER BY n DESC`, [org])).rows;
    return ok(req, res, {
      pipeline: byStage,
      pipeline_total: open.reduce((a: Money, r: any) => a.add(r.amount), Money.zero()).toFixed(2),
      weighted_forecast: weightedForecast(open as any),
      win_rate_pct: closed.won + closed.lost ? ((closed.won / (closed.won + closed.lost)) * 100).toFixed(1) : null,
      won_mtd: new Money(closed.won_mtd).toFixed(2),
      leads,
      lead_conversion_pct: leads.total ? ((leads.converted / leads.total) * 100).toFixed(1) : null,
      overdue_activities: overdue,
      loss_reasons: lossReasons,
    });
  });
}
