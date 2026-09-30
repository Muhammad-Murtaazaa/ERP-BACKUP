import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { Money, BankReconciliationEngine } from '@omnysync/financial-engine';
import { ErrorCode, Permission, StandardErrorResponse, StandardSuccessResponse } from '@omnysync/contracts';
import { db, auditLogger, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, sodViolation, validationError } from '../lib/errors.js';
import { arrayOf, bool, dateOnly, decimal, int, optionalDate, optionalStr, optionalUuid, str, toIsoDate, uuid } from '../lib/validate.js';
import { requireOrgRow } from '../lib/scope.js';

const CCY = /^[A-Z]{3}$/;

/** GL lines on a bank account up to a date (POSTED and REVERSED journals are both in the ledger). */
async function bankGlLines(q: any, org: string, accountId: string, asOf: string) {
  return (
    await q.query(
      `SELECT jl.id, jl.base_debit, jl.base_credit, jl.description, j.journal_number, j.posting_date, j.description AS journal_description,
              (SELECT bsl.id FROM bank_statement_lines bsl WHERE bsl.matched_journal_line_id = jl.id LIMIT 1) AS matched_statement_line_id
       FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
       WHERE jl.account_id = $1 AND j.organization_id = $2 AND j.status IN ('POSTED','REVERSED') AND j.posting_date <= $3
       ORDER BY j.posting_date ASC, j.journal_number ASC`,
      [accountId, org, asOf],
    )
  ).rows;
}

async function lockStatementLine(q: any, org: string, lineId: string) {
  const r = await q.query(
    `SELECT bsl.*, bs.bank_account_id, bs.status AS statement_status, bs.id AS stmt_id FROM bank_statement_lines bsl
     JOIN bank_statements bs ON bs.id = bsl.statement_id WHERE bsl.id::text = $1 AND bs.organization_id = $2 FOR UPDATE OF bsl`,
    [lineId, org],
  );
  if (!r.rows[0]) throw new ApiError(404, ErrorCode.RESOURCE_NOT_FOUND, 'Statement line not found');
  if (r.rows[0].statement_status === 'RECONCILED') throw new ApiError(409, ErrorCode.STATEMENT_ALREADY_RECONCILED, 'Statement is already reconciled');
  return r.rows[0];
}

export function registerTreasuryRoutes(app: Express): void {
  const treasuryRead = requireAnyPermission(Permission.TREASURY_BANK_RECONCILE, Permission.TREASURY_FX_MANAGE, Permission.FINANCE_REPORTS_VIEW, Permission.PAYMENT_MANAGE);

  // ---------------- FX rates ----------------
  app.get('/api/fx/rates', authenticate, treasuryRead, async (req: Request, res: Response) => {
    const r = await db.query('SELECT * FROM exchange_rates WHERE organization_id = $1 ORDER BY effective_date DESC, from_currency ASC', [req.session!.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  app.post('/api/fx/rates', authenticate, requirePermission(Permission.TREASURY_FX_MANAGE), async (req: Request, res: Response) => {
    const from = str(req.body?.from_currency, 'from_currency', { max: 3 }).toUpperCase();
    const to = str(req.body?.to_currency, 'to_currency', { max: 3 }).toUpperCase();
    if (!CCY.test(from) || !CCY.test(to)) throw validationError('Currencies must be ISO 4217 3-letter codes');
    if (from === to) throw validationError('from_currency and to_currency must differ');
    const rate = decimal(req.body?.rate == null ? undefined : String(req.body.rate), 'rate', { sign: 'positive', scale: 12 });
    const effective_date = dateOnly(req.body?.effective_date, 'effective_date');
    const source = optionalStr(req.body?.source, 'source', 32) || 'MANUAL';
    const out = await db.transaction(async (tx) => {
      const before = (await tx.query(`SELECT * FROM exchange_rates WHERE organization_id = $1 AND from_currency = $2 AND to_currency = $3 AND effective_date = $4 FOR UPDATE`, [req.session!.organization_id, from, to, effective_date])).rows[0];
      const id = before?.id || crypto.randomUUID();
      await tx.query(
        `INSERT INTO exchange_rates (id, organization_id, from_currency, to_currency, rate, effective_date, source) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (organization_id, from_currency, to_currency, effective_date) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source`,
        [id, req.session!.organization_id, from, to, rate, effective_date, source],
      );
      // Rate corrections are audited with before/after (previously silently overwritten).
      await auditLogger.record({ organization_id: req.session!.organization_id, user_id: req.session!.user_id, action: before ? 'FX_RATE_CORRECTED' : 'FX_RATE_CREATED', entity_type: 'EXCHANGE_RATE', entity_id: id, before_state: before ? { rate: before.rate } : undefined, after_state: { from, to, rate, effective_date, source }, correlation_id: req.correlationId }, tx);
      return { id, from_currency: from, to_currency: to, rate, effective_date };
    });
    return ok(req, res, out, 201);
  });

  // ---------------- Bank statements ----------------
  app.get('/api/treasury/statements', authenticate, treasuryRead, async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT bs.*, a.name as bank_account_name, a.code as bank_account_code,
              (SELECT COUNT(*) FROM bank_statement_lines l WHERE l.statement_id = bs.id) AS line_count,
              (SELECT COUNT(*) FROM bank_statement_lines l WHERE l.statement_id = bs.id AND l.is_matched) AS matched_count
       FROM bank_statements bs JOIN accounts a ON a.id = bs.bank_account_id WHERE bs.organization_id = $1 ORDER BY bs.statement_date DESC`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  app.get('/api/treasury/statements/:id', authenticate, treasuryRead, async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const st = (
      await db.query(`SELECT bs.*, a.name as bank_account_name, a.code as bank_account_code FROM bank_statements bs JOIN accounts a ON a.id = bs.bank_account_id WHERE bs.id::text = $1 AND bs.organization_id = $2`, [req.params.id, org])
    ).rows[0];
    if (!st) throw new ApiError(404, ErrorCode.RESOURCE_NOT_FOUND, 'Bank statement not found');
    const lines = (await db.query('SELECT * FROM bank_statement_lines WHERE statement_id = $1 ORDER BY line_number ASC', [st.id])).rows;
    const asOf = toIsoDate(st.statement_date);
    const gl = await bankGlLines(db, org, st.bank_account_id, asOf);
    let glBalance = Money.zero();
    for (const l of gl) glBalance = glBalance.add(l.base_debit).sub(l.base_credit);
    const summary = BankReconciliationEngine.computeReconciliation({ statementOpeningBalance: st.opening_balance, statementClosingBalance: st.closing_balance, glBalanceAsOfDate: glBalance.toFixed(8), statementLines: lines });
    return ok(req, res, { ...st, lines, summary, gl_balance: glBalance.format(), unreconciled_gl_lines: gl.filter((l: any) => !l.matched_statement_line_id) });
  });

  app.post('/api/treasury/statements/upload', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const bank_account_id = uuid(req.body?.bank_account_id, 'bank_account_id');
    const bank = (await db.query(`SELECT * FROM accounts WHERE id = $1 AND organization_id = $2 AND level = 4`, [bank_account_id, org])).rows[0];
    if (!bank || !(bank.control_type === 'BANK' || String(bank.code).startsWith('1110'))) throw validationError('bank_account_id must be a bank/cash posting account', { field: 'bank_account_id' });
    const statement_reference = str(req.body?.statement_reference, 'statement_reference', { max: 64 });
    const statement_date = dateOnly(req.body?.statement_date, 'statement_date');
    const opening = decimal(req.body?.opening_balance, 'opening_balance', { sign: 'any', required: false, defaultValue: '0' });
    const closing = decimal(req.body?.closing_balance, 'closing_balance', { sign: 'any', required: false, defaultValue: '0' });
    const lines = arrayOf<any>(req.body?.lines, 'lines', { min: 1, max: 10000 }).map((l, i) => {
      const transaction_date = dateOnly(l?.transaction_date, `lines[${i}].transaction_date`);
      if (transaction_date > statement_date) throw validationError(`lines[${i}].transaction_date is after the statement date`);
      const amount = decimal(l?.amount, `lines[${i}].amount`, { sign: 'any' });
      if (new Money(amount).isZero()) throw validationError(`lines[${i}].amount cannot be zero`);
      return { transaction_date, value_date: optionalDate(l?.value_date, `lines[${i}].value_date`) || transaction_date, amount, reference: optionalStr(l?.reference, 'reference', 255), description: optionalStr(l?.description, 'description', 1000) };
    });
    // Statement integrity: opening + movements must equal closing.
    let movement = Money.zero();
    for (const l of lines) movement = movement.add(l.amount);
    if (!new Money(opening).add(movement).eq(closing)) {
      throw validationError(`Statement does not foot: opening ${new Money(opening).format()} + lines ${movement.format()} != closing ${new Money(closing).format()}`, { field: 'closing_balance' });
    }
    const statementId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO bank_statements (id, organization_id, legal_entity_id, bank_account_id, statement_reference, statement_date, opening_balance, closing_balance, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UPLOADED', $9)`,
        [statementId, org, req.session!.legal_entity_id, bank_account_id, statement_reference, statement_date, opening, closing, req.session!.user_id],
      );
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await tx.query(
          `INSERT INTO bank_statement_lines (id, statement_id, line_number, transaction_date, value_date, amount, reference, description, is_matched) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)`,
          [crypto.randomUUID(), statementId, i + 1, l.transaction_date, l.value_date, l.amount, l.reference, l.description],
        );
      }
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'BANK_STATEMENT_UPLOADED', entity_type: 'BANK_STATEMENT', entity_id: statementId, after_state: { statement_reference, lines: lines.length, closing }, correlation_id: req.correlationId }, tx);
    });
    return ok(req, res, { id: statementId, statement_reference, status: 'UPLOADED', line_count: lines.length }, 201);
  });

  /**
   * Match / clear a statement line. Previously this updated any line by id across
   * tenants, with no amount or account checks, and allowed one GL line to clear
   * several statement lines.
   */
  app.post('/api/treasury/reconciliation/match', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const statement_line_id = uuid(req.body?.statement_line_id, 'statement_line_id');
    const journal_line_id = optionalUuid(req.body?.journal_line_id, 'journal_line_id');
    const is_matched = req.body?.is_matched === undefined ? true : bool(req.body.is_matched);
    const out = await db.transaction(async (tx) => {
      const line = await lockStatementLine(tx, org, statement_line_id);
      if (is_matched && journal_line_id) {
        const jl = (
          await tx.query(`SELECT jl.*, j.posting_date FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id WHERE jl.id = $1 AND j.organization_id = $2 AND j.status IN ('POSTED','REVERSED')`, [journal_line_id, org])
        ).rows[0];
        if (!jl) throw validationError('Journal line not found', { field: 'journal_line_id' });
        if (jl.account_id !== line.bank_account_id) throw validationError('Journal line is not on the statement bank account', { field: 'journal_line_id' });
        const net = new Money(jl.base_debit).sub(jl.base_credit);
        if (!net.eq(line.amount)) throw new ApiError(409, ErrorCode.RECONCILIATION_MISMATCH, `Amounts differ: statement ${new Money(line.amount).format()} vs GL ${net.format()}`);
        const taken = await tx.query(`SELECT id FROM bank_statement_lines WHERE matched_journal_line_id = $1 AND id <> $2`, [journal_line_id, line.id]);
        if (taken.rows.length) throw new ApiError(409, ErrorCode.RECONCILIATION_MISMATCH, 'Journal line is already matched to another statement line');
      }
      await tx.query(`UPDATE bank_statement_lines SET is_matched = $1, matched_journal_line_id = $2 WHERE id = $3`, [is_matched, is_matched ? journal_line_id : null, line.id]);
      await tx.query(`UPDATE bank_statements SET status = 'RECONCILING', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'UPLOADED'`, [line.stmt_id]);
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: is_matched ? 'BANK_LINE_MATCHED' : 'BANK_LINE_UNMATCHED', entity_type: 'BANK_STATEMENT_LINE', entity_id: line.id, after_state: { journal_line_id, manual_clear: is_matched && !journal_line_id }, correlation_id: req.correlationId }, tx);
      return { statement_line_id: line.id, is_matched, journal_line_id };
    });
    return ok(req, res, out);
  });

  /** Automatic matching: exact amount, same account, date within tolerance, reference hint. */
  app.post('/api/treasury/statements/:id/auto-match', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const toleranceDays = int(req.body?.date_tolerance_days, 'date_tolerance_days', { min: 0, max: 31, defaultValue: 5 });
    const out = await db.transaction(async (tx) => {
      const st = await requireOrgRow(tx, 'bank_statements', req.params.id, org, 'Bank statement', { forUpdate: true });
      if (st.status === 'RECONCILED') throw new ApiError(409, ErrorCode.STATEMENT_ALREADY_RECONCILED, 'Statement is already reconciled');
      const lines = (await tx.query(`SELECT * FROM bank_statement_lines WHERE statement_id = $1 AND is_matched = false ORDER BY line_number`, [st.id])).rows;
      const gl = (await bankGlLines(tx, org, st.bank_account_id, toIsoDate(st.statement_date))).filter((l: any) => !l.matched_statement_line_id);
      const suggestions = BankReconciliationEngine.suggestMatches(
        lines.map((l: any) => ({ id: l.id, date: toIsoDate(l.transaction_date), amount: l.amount, reference: l.reference || '', description: l.description || '' })),
        gl.map((g: any) => ({ id: g.id, date: toIsoDate(g.posting_date), amount: new Money(g.base_debit).sub(g.base_credit).toFixed(8), text: `${g.journal_number} ${g.journal_description || ''} ${g.description || ''}` })),
        toleranceDays,
      );
      for (const m of suggestions) {
        await tx.query(`UPDATE bank_statement_lines SET is_matched = true, matched_journal_line_id = $1 WHERE id = $2`, [m.journalLineId, m.statementLineId]);
      }
      if (suggestions.length) await tx.query(`UPDATE bank_statements SET status = 'RECONCILING', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'UPLOADED'`, [st.id]);
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'BANK_AUTO_MATCH', entity_type: 'BANK_STATEMENT', entity_id: st.id, after_state: { matched: suggestions.length, remaining: lines.length - suggestions.length }, correlation_id: req.correlationId }, tx);
      return { statement_id: st.id, matched: suggestions.length, remaining_unmatched: lines.length - suggestions.length, matches: suggestions };
    });
    return ok(req, res, out);
  });

  /**
   * Sign-off. The GL balance and difference are now computed from the ledger
   * (previously the GL balance was simply set equal to the statement balance).
   * Segregation: the uploader cannot sign off; a non-zero difference requires notes.
   */
  app.post('/api/treasury/reconciliation/sign-off', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const statement_id = uuid(req.body?.statement_id, 'statement_id');
    const notes = optionalStr(req.body?.notes, 'notes', 2000);
    const out = await db.transaction(async (tx) => {
      const st = await requireOrgRow(tx, 'bank_statements', statement_id, org, 'Bank statement', { forUpdate: true });
      if (st.status === 'RECONCILED') throw new ApiError(409, ErrorCode.STATEMENT_ALREADY_RECONCILED, 'Statement is already reconciled');
      if (st.created_by && st.created_by === req.session!.user_id) throw sodViolation('Segregation of duties: the statement uploader cannot sign off the reconciliation');
      const lines = (await tx.query('SELECT * FROM bank_statement_lines WHERE statement_id = $1', [st.id])).rows;
      const unmatched = lines.filter((l: any) => !l.is_matched);
      if (unmatched.length > 0) throw new ApiError(400, ErrorCode.RECONCILIATION_MISMATCH, `Cannot sign off: ${unmatched.length} statement line(s) remain unmatched`);
      const gl = await bankGlLines(tx, org, st.bank_account_id, toIsoDate(st.statement_date));
      let glBalance = Money.zero();
      let outstanding = Money.zero();
      for (const l of gl) {
        const net = new Money(l.base_debit).sub(l.base_credit);
        glBalance = glBalance.add(net);
        if (!l.matched_statement_line_id) outstanding = outstanding.add(net);
      }
      // Manually cleared statement lines (no GL link) are reconciling items too.
      let manualCleared = Money.zero();
      for (const l of lines) if (l.is_matched && !l.matched_journal_line_id) manualCleared = manualCleared.add(l.amount);
      const difference = new Money(st.closing_balance).sub(glBalance.sub(outstanding).add(manualCleared));
      if (!difference.isZero() && !notes) throw validationError('A non-zero unreconciled difference requires sign-off notes', { field: 'notes', difference: difference.format() });
      const reconId = crypto.randomUUID();
      await tx.query("UPDATE bank_statements SET status = 'RECONCILED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [st.id]);
      await tx.query(
        `INSERT INTO bank_reconciliations (id, statement_id, reconciled_date, statement_closing_balance, gl_closing_balance, unreconciled_difference, status, reconciled_by, notes)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 'COMPLETED', $6, $7)`,
        [reconId, st.id, st.closing_balance, glBalance.toFixed(8), difference.toFixed(8), req.session!.user_id, notes],
      );
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'BANK_STATEMENT_RECONCILED', entity_type: 'BANK_STATEMENT', entity_id: st.id, after_state: { status: 'RECONCILED', statement_reference: st.statement_reference, gl_balance: glBalance.format(), outstanding_items: outstanding.format(), difference: difference.format() }, correlation_id: req.correlationId }, tx);
      return { statement_id: st.id, status: 'RECONCILED', reconciliation_id: reconId, gl_balance: glBalance.format(), outstanding_items: outstanding.format(), unreconciled_difference: difference.format() };
    });
    return ok(req, res, out);
  });

  // ==========================================
  // 16. M3: Onboarding & Industry Template Provisioning
  // ==========================================
  app.get('/api/onboarding/profile', authenticate, requireAnyPermission(Permission.ONBOARDING_MANAGE, Permission.ORG_MANAGE, Permission.FINANCE_REPORTS_VIEW), async (req: Request, res: Response) => {
    const profileRes = await db.query('SELECT * FROM onboarding_profiles WHERE organization_id = $1 LIMIT 1', [
      req.session!.organization_id,
    ]);

    return res.json({
      success: true,
      data: profileRes.rows[0] || {
        organization_id: req.session!.organization_id,
        industry_template: 'WHOLESALE_DISTRIBUTION',
        setup_step: 'COMPLETED',
        is_completed: true,
      },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/onboarding/provision', authenticate, requirePermission(Permission.ONBOARDING_MANAGE), async (req: Request, res: Response) => {
    const { industry_template } = req.body;

    const validTemplates = ['WHOLESALE_DISTRIBUTION', 'SERVICES_CONSULTING', 'LIGHT_MANUFACTURING', 'CUSTOM'];
    if (!validTemplates.includes(industry_template)) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: `industry_template must be one of: ${validTemplates.join(', ')}`,
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const profileId = crypto.randomUUID();
    await db.query(
      `
      INSERT INTO onboarding_profiles (id, organization_id, industry_template, setup_step, is_completed, completed_at)
      VALUES ($1, $2, $3, 'COMPLETED', true, CURRENT_TIMESTAMP)
    `,
      [profileId, req.session!.organization_id, industry_template],
    );

    return res.status(201).json({
      success: true,
      data: { id: profileId, industry_template, is_completed: true },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
}
