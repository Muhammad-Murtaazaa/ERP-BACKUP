/** TAX: effective-dated codes, line calculation API, ledger-derived returns, filing and settlement. */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode, AccountingPurpose } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission, auditLogger, outboxService } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { defineResource, audit, emit } from '../lib/resource.js';
import { arrayOf, dateOnly, decimal, str, toIsoDate, todayIso } from '../lib/validate.js';
import { postJournal } from '../lib/posting.js';
import { computeTax, effectiveCode, windowsOverlap } from '../domain/tax.js';

async function ledgerTax(q: any, org: string, from: string, to: string) {
  const r = await q.query(
    `SELECT a.code, COALESCE(SUM(jl.base_credit - jl.base_debit),0)::text AS net
     FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
     WHERE j.organization_id = $1 AND j.status = 'POSTED' AND j.posting_date BETWEEN $2 AND $3 AND a.code IN ('212001','114001')
       AND COALESCE(j.source_type,'') <> 'TAX_RETURN'
     GROUP BY a.code`,
    [org, from, to],
  );
  const by = new Map<string, Money>(r.rows.map((x: any) => [x.code, new Money(x.net)]));
  const output = (by.get('212001') || Money.zero()).round(2);
  const input = (by.get('114001') || Money.zero()).negated().round(2);
  return { output: output.toFixed(2), input: input.toFixed(2), net: output.sub(input).toFixed(2) };
}

export function registerTaxRoutes(app: Express): void {
  defineResource(app, {
    path: '/api/tax/codes',
    table: 'tax_codes',
    label: 'Tax code',
    event: 'TAX_CODE',
    module: 'TAX',
    view: [Permission.TAX_VIEW, Permission.TAX_MANAGE],
    create: Permission.TAX_MANAGE,
    update: Permission.TAX_MANAGE,
    fields: {
      code: { type: 'string', required: true, max: 32, pattern: /^[A-Z0-9_-]+$/ },
      name: { type: 'string', required: true },
      kind: { type: 'enum', values: ['OUTPUT', 'INPUT', 'WITHHOLDING', 'EXEMPT'], required: true },
      rate: { type: 'decimal', required: true, scale: 4 },
      is_inclusive: { type: 'bool' },
      account_code: { type: 'string', max: 16 },
      effective_from: { type: 'date', required: true },
      effective_to: { type: 'date' },
    },
    editable: ['name', 'effective_to', 'account_code'],
    search: ['code', 'name'],
    filters: ['kind'],
    orderBy: 't.code, t.effective_from DESC',
    beforeCreate: async (ctx, v) => {
      if (Number(v.rate) > 100) throw validationError('rate cannot exceed 100', { field: 'rate' });
      if (v.effective_to && v.effective_to < v.effective_from) throw validationError('effective_to must be on or after effective_from', { field: 'effective_to' });
      const existing = await ctx.tx.query(`SELECT * FROM tax_codes WHERE organization_id = $1 AND code = $2 AND status = 'ACTIVE' FOR UPDATE`, [ctx.org, v.code]);
      for (const e of existing.rows) {
        if (windowsOverlap(v.effective_from, v.effective_to, toIsoDate(e.effective_from), e.effective_to ? toIsoDate(e.effective_to) : null)) {
          throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Tax code ${v.code} already has a version effective ${toIsoDate(e.effective_from)}${e.effective_to ? ` – ${toIsoDate(e.effective_to)}` : ' onwards'}; end-date it first`, { field: 'effective_from' });
        }
      }
    },
    commands: { retire: { from: ['ACTIVE'], to: 'RETIRED', permission: Permission.TAX_MANAGE } },
  });

  app.post('/api/tax/calculate', authenticate, requireAnyPermission(Permission.TAX_VIEW, Permission.TAX_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const lines = arrayOf<any>(req.body?.lines, 'lines', { min: 1, max: 200 });
    const codes = (await db.query(`SELECT * FROM tax_codes WHERE organization_id = $1`, [org])).rows;
    let net = Money.zero();
    let tax = Money.zero();
    const out = lines.map((l, i) => {
      const amount = decimal(l.amount, `lines[${i}].amount`, { sign: 'nonNegative', scale: 4 });
      const date = dateOnly(l.date || todayIso(), `lines[${i}].date`);
      const code = str(l.tax_code, `lines[${i}].tax_code`, { max: 32 });
      const version = effectiveCode(codes.filter((c) => c.code === code).map((c) => ({ ...c, effective_from: toIsoDate(c.effective_from), effective_to: c.effective_to ? toIsoDate(c.effective_to) : null })), date);
      if (!version) throw new ApiError(400, ErrorCode.MAPPING_MISSING, `No tax code ${code} effective on ${date}`, { field: `lines[${i}].tax_code` });
      const r = computeTax({ amount, rate: String(version.rate), inclusive: l.inclusive ?? version.is_inclusive });
      net = net.add(r.net);
      tax = tax.add(r.tax);
      return { ...r, tax_code: code, rate: new Money(version.rate).toFixed(4), effective_from: version.effective_from };
    });
    return ok(req, res, { lines: out, total_net: net.toFixed(2), total_tax: tax.toFixed(2), total_gross: net.add(tax).toFixed(2) });
  });

  app.get('/api/tax/summary', authenticate, requireAnyPermission(Permission.TAX_VIEW, Permission.TAX_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const y = todayIso().slice(0, 7);
    const t = await ledgerTax(db, org, `${y}-01`, todayIso());
    const counts = (await db.query(`SELECT status, COUNT(*)::int n FROM tax_returns WHERE organization_id = $1 GROUP BY status`, [org])).rows;
    const codes = (await db.query(`SELECT COUNT(*)::int n FROM tax_codes WHERE organization_id = $1 AND status = 'ACTIVE'`, [org])).rows[0].n;
    return ok(req, res, { month_to_date: t, returns: Object.fromEntries(counts.map((c) => [c.status, c.n])), active_codes: codes });
  });

  defineResource(app, {
    path: '/api/tax/returns',
    table: 'tax_returns',
    label: 'Tax return',
    event: 'TAX_RETURN',
    module: 'TAX',
    view: [Permission.TAX_VIEW, Permission.TAX_MANAGE],
    create: Permission.TAX_MANAGE,
    update: false,
    fields: { period_start: { type: 'date', required: true }, period_end: { type: 'date', required: true }, notes: { type: 'text' } },
    numbering: { column: 'number', prefix: 'TAXR', dateField: 'period_end' },
    initialStatus: 'DRAFT',
    search: ['number'],
    orderBy: 't.period_start DESC',
    beforeCreate: async (ctx, v) => {
      if (v.period_end < v.period_start) throw validationError('period_end must be on or after period_start', { field: 'period_end' });
      const t = await ledgerTax(ctx.tx, ctx.org, v.period_start, v.period_end);
      v.output_tax = t.output;
      v.input_tax = t.input;
      v.net_payable = t.net;
    },
    commands: {
      recalculate: {
        from: ['DRAFT'],
        permission: Permission.TAX_MANAGE,
        run: async (ctx, row) => {
          const t = await ledgerTax(ctx.tx, ctx.org, toIsoDate(row.period_start), toIsoDate(row.period_end));
          return { set: { output_tax: t.output, input_tax: t.input, net_payable: t.net } };
        },
      },
      file: {
        from: ['DRAFT'],
        to: 'FILED',
        permission: Permission.TAX_FILE,
        sodColumn: 'created_by',
        fields: { filing_reference: { type: 'string', required: true, max: 80 } },
        run: async (ctx, row, input) => {
          // Re-derive at command time: a return that no longer matches the ledger cannot be filed.
          const t = await ledgerTax(ctx.tx, ctx.org, toIsoDate(row.period_start), toIsoDate(row.period_end));
          if (!new Money(t.net).eq(row.net_payable)) {
            throw new ApiError(409, ErrorCode.STALE_REVISION, `Ledger tax changed since preparation (now ${t.net}); recalculate before filing`);
          }
          return { set: { filing_reference: input.filing_reference, filed_by: ctx.user, filed_at: new Date().toISOString() } };
        },
      },
      settle: {
        from: ['FILED'],
        to: 'SETTLED',
        permission: Permission.TAX_FILE,
        fields: { payment_date: { type: 'date', required: true } },
        run: async (ctx, row, input) => {
          const out = new Money(row.output_tax);
          const inp = new Money(row.input_tax);
          const net = out.sub(inp);
          const lines: any[] = [];
          if (out.isPositive()) lines.push({ account_code: '212001', debit: out.toFixed(8), description: `Clear output tax ${row.number}` });
          if (inp.isPositive()) lines.push({ account_code: '114001', credit: inp.toFixed(8), description: `Clear input tax ${row.number}` });
          if (net.isPositive()) lines.push({ account_code: '111002', credit: net.toFixed(8), description: `Tax paid ${row.number}` });
          else if (net.isNegative()) lines.push({ account_code: '114002', debit: net.abs().toFixed(8), description: `Refundable tax carried forward ${row.number}` });
          const posted = await postJournal(ctx.tx, auditLogger, outboxService, {
            organizationId: ctx.org, legalEntityId: row.legal_entity_id || ctx.le, userId: ctx.user, postingDate: input.payment_date,
            purpose: AccountingPurpose.TAX_SETTLEMENT, description: `Tax return settlement ${row.number}`, sourceType: 'TAX_RETURN', sourceId: row.id,
            sourceKey: `TAX_RETURN:${row.id}`, numberPrefix: 'JV-TAX', correlationId: ctx.req.correlationId, lines,
          });
          return { set: { settlement_journal_id: posted?.journalId ?? null }, data: { journal_number: posted?.journalNumber ?? null } };
        },
      },
      cancel: { from: ['DRAFT'], to: 'CANCELLED', permission: Permission.TAX_MANAGE },
    },
  });
  void audit;
  void emit;
}
