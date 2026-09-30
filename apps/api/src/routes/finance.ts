import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { JournalValidator, CoaHierarchyValidator, LedgerEngine, JournalReversalEngine, Money } from '@omnysync/financial-engine';
import { ErrorCode, Permission, JournalStatus, AccountingPurpose, Account, Journal, JournalLine } from '@omnysync/contracts';
import { db, auditLogger, outboxService, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, notFound, validationError, sodViolation } from '../lib/errors.js';
import { arrayOf, dateOnly, decimal, int, oneOf, optionalStr, optionalUuid, pagination, str, todayIso, toIsoDate } from '../lib/validate.js';
import { transition } from '../lib/state.js';
import { requireOrgRow } from '../lib/scope.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { postJournal } from '../lib/posting.js';

/** Allowed fiscal period transitions. Reopening a hard-closed period needs a reason. */
export const PERIOD_TRANSITIONS: Record<string, readonly string[]> = {
  OPEN: ['SOFT_CLOSED', 'HARD_CLOSED'],
  SOFT_CLOSED: ['OPEN', 'HARD_CLOSED'],
  HARD_CLOSED: ['OPEN', 'SOFT_CLOSED'],
};

const MANUAL_PURPOSES = [
  AccountingPurpose.MANUAL_JOURNAL,
  AccountingPurpose.OPENING_BALANCE,
  AccountingPurpose.BANK_CHARGE,
  AccountingPurpose.FX_REVALUATION,
] as const;

export function registerFinanceRoutes(app: Express): void {
  // ==========================================
  // 3. Chart of Accounts (COA)
  // ==========================================
  app.get('/api/coa/accounts', authenticate, async (req: Request, res: Response) => {
    const accountsRes = await db.query<Account>('SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code ASC', [
      req.session!.organization_id,
    ]);
    return ok(req, res, accountsRes.rows, 200, { total_count: accountsRes.rows.length });
  });

  app.get('/api/coa/tree', authenticate, async (req: Request, res: Response) => {
    const accountsRes = await db.query<Account>('SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code ASC', [
      req.session!.organization_id,
    ]);
    return ok(req, res, CoaHierarchyValidator.buildTree(accountsRes.rows));
  });

  app.post('/api/coa/accounts', authenticate, requirePermission(Permission.FINANCE_COA_MANAGE), async (req: Request, res: Response) => {
    const body = req.body || {};
    const code = str(body.code, 'code', { max: 32, pattern: /^[A-Za-z0-9._-]+$/ });
    const name = str(body.name, 'name', { max: 255 });
    const level = int(body.level, 'level', { min: 1, max: 4 });
    const statement_class = oneOf(body.statement_class, 'statement_class', ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const);
    const normal_balance = oneOf(body.normal_balance, 'normal_balance', ['DEBIT', 'CREDIT'] as const);
    const posting_allowed = body.posting_allowed === true;
    const parent_id = optionalUuid(body.parent_id, 'parent_id');
    const control_type = optionalStr(body.control_type, 'control_type', 32) || 'GENERAL';
    const currency_restriction = optionalStr(body.currency_restriction, 'currency_restriction', 3);

    let parent: Account | null = null;
    if (parent_id) {
      const parentQuery = await db.query<Account>('SELECT * FROM accounts WHERE id = $1 AND organization_id = $2', [
        parent_id,
        req.session!.organization_id,
      ]);
      parent = parentQuery.rows[0] || null;
      // Previously a foreign/unknown parent id silently passed validation.
      if (!parent) throw validationError('Parent account not found in this organization', { field: 'parent_id' });
    }

    const validation = CoaHierarchyValidator.validateAccount({ level: level as any, parent_id, statement_class, normal_balance, posting_allowed }, parent);
    if (!validation.valid) throw validationError(validation.error || 'Invalid account hierarchy parameters');

    const accountId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO accounts (
          id, organization_id, legal_entity_id, code, name, parent_id, level,
          statement_class, normal_balance, posting_allowed, control_type, currency_restriction, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)`,
        [
          accountId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          code,
          name,
          parent_id,
          level,
          statement_class,
          normal_balance,
          posting_allowed,
          control_type,
          currency_restriction,
        ],
      );
      await auditLogger.record(
        {
          organization_id: req.session!.organization_id,
          user_id: req.session!.user_id,
          action: 'COA_ACCOUNT_CREATED',
          entity_type: 'ACCOUNT',
          entity_id: accountId,
          after_state: { code, name, level, parent_id, statement_class, normal_balance, posting_allowed, control_type },
          correlation_id: req.correlationId,
        },
        tx,
      );
    });

    return ok(req, res, { id: accountId, code, name, level }, 201);
  });

  // ==========================================
  // 4. Fiscal Periods
  // ==========================================
  app.get('/api/periods', authenticate, async (req: Request, res: Response) => {
    const periodsRes = await db.query(
      'SELECT * FROM fiscal_periods WHERE organization_id = $1 ORDER BY fiscal_year ASC, period_number ASC',
      [req.session!.organization_id],
    );
    return ok(req, res, periodsRes.rows);
  });

  app.post('/api/periods/:id/status', authenticate, requirePermission(Permission.FINANCE_PERIOD_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;
    const status = oneOf(req.body?.status, 'status', ['OPEN', 'SOFT_CLOSED', 'HARD_CLOSED'] as const);
    const reason = optionalStr(req.body?.reason, 'reason', 500);

    const result = await db.transaction(async (tx) => {
      // Same row lock as the posting guard (TX-006) so a close cannot race a late post.
      const period = await requireOrgRow(tx, 'fiscal_periods', id, req.session!.organization_id, 'Fiscal period', { forUpdate: true });
      if (period.status === status) return { id, status, unchanged: true };
      const allowed = PERIOD_TRANSITIONS[period.status] || [];
      if (!allowed.includes(status)) {
        throw new ApiError(409, ErrorCode.INVALID_STATE, `Period cannot move from ${period.status} to ${status}`);
      }
      const reopening = period.status === 'HARD_CLOSED' || (period.status === 'SOFT_CLOSED' && status === 'OPEN');
      if (reopening && !reason) {
        throw validationError('A reason is required to reopen a closed period', { field: 'reason' });
      }
      await tx.query('UPDATE fiscal_periods SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND organization_id = $3', [
        status,
        id,
        req.session!.organization_id,
      ]);
      await auditLogger.record(
        {
          organization_id: req.session!.organization_id,
          user_id: req.session!.user_id,
          action: reopening ? 'PERIOD_REOPENED' : 'PERIOD_STATUS_CHANGED',
          entity_type: 'FISCAL_PERIOD',
          entity_id: id,
          before_state: { status: period.status },
          after_state: { status, reason },
          correlation_id: req.correlationId,
        },
        tx,
      );
      await outboxService.emit(
        { organization_id: req.session!.organization_id, event_type: 'PERIOD_STATUS_CHANGED', payload: { period_id: id, from: period.status, to: status } },
        tx,
      );
      return { id, status };
    });

    return ok(req, res, result);
  });

  // ==========================================
  // 5. Journals & Immutable Posting Workflow
  // ==========================================
  app.get(
    '/api/journals',
    authenticate,
    requireAnyPermission(Permission.FINANCE_REPORTS_VIEW, Permission.FINANCE_JOURNAL_CREATE),
    async (req: Request, res: Response) => {
      const status = optionalStr(req.query.status, 'status', 20);
      const search = optionalStr(req.query.search, 'search', 100);
      const purpose = optionalStr(req.query.purpose, 'purpose', 64);
      const { limit, offset } = pagination(req.query as Record<string, unknown>, { limit: 100, max: 500 });

      let where = 'j.organization_id = $1';
      const params: unknown[] = [req.session!.organization_id];
      if (status) {
        params.push(status);
        where += ` AND j.status = $${params.length}`;
      }
      if (purpose) {
        params.push(purpose);
        where += ` AND j.accounting_purpose = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        where += ` AND (j.journal_number ILIKE $${params.length} OR j.description ILIKE $${params.length})`;
      }
      const count = await db.query(`SELECT COUNT(*)::int AS n FROM journals j WHERE ${where}`, params);
      params.push(limit, offset);
      const journalsRes = await db.query(
        `SELECT j.*, u.name as creator_name
         FROM journals j LEFT JOIN users u ON u.id = j.created_by
         WHERE ${where}
         ORDER BY j.posting_date DESC, j.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return ok(req, res, journalsRes.rows, 200, { total_count: count.rows[0].n, limit, offset });
    },
  );

  app.get(
    '/api/journals/:id',
    authenticate,
    requireAnyPermission(Permission.FINANCE_REPORTS_VIEW, Permission.FINANCE_JOURNAL_CREATE),
    async (req: Request, res: Response) => {
      const journal = await requireOrgRow(db, 'journals', req.params.id, req.session!.organization_id, 'Journal entry');
      const linesRes = await db.query(
        `SELECT jl.*, a.code as account_code, a.name as account_name, a.level as account_level
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
         WHERE jl.journal_id = $1 ORDER BY jl.line_number ASC`,
        [journal.id],
      );
      return ok(req, res, { ...journal, lines: linesRes.rows });
    },
  );

  app.post('/api/journals/draft', authenticate, requirePermission(Permission.FINANCE_JOURNAL_CREATE), async (req: Request, res: Response) => {
    const body = req.body || {};
    const posting_date = dateOnly(body.posting_date, 'posting_date');
    const document_date = dateOnly(body.document_date, 'document_date', { defaultValue: posting_date });
    const description = str(body.description, 'description', { max: 1000 });
    const accounting_purpose = oneOf(body.accounting_purpose, 'accounting_purpose', MANUAL_PURPOSES, AccountingPurpose.MANUAL_JOURNAL);
    const rawLines = arrayOf<any>(body.lines, 'lines', { min: 0, max: 500 });

    const lines = rawLines.map((l, i) => {
      const debit = decimal(l?.debit_amount, `lines[${i}].debit_amount`, { required: false, sign: 'any' });
      const credit = decimal(l?.credit_amount, `lines[${i}].credit_amount`, { required: false, sign: 'any' });
      return {
        line_number: i + 1,
        account_id: String(l?.account_id || ''),
        debit_amount: debit,
        credit_amount: credit,
        base_debit: debit,
        base_credit: credit,
        description: optionalStr(l?.description, `lines[${i}].description`, 500),
      } as unknown as JournalLine;
    });

    const accountsRes = await db.query<Account>('SELECT * FROM accounts WHERE organization_id = $1', [req.session!.organization_id]);
    const accountMap = new Map(accountsRes.rows.map((a) => [a.id, a]));
    const validation = JournalValidator.validate(lines, accountMap);
    if (!validation.isValid) {
      throw new ApiError(400, ErrorCode.JOURNAL_UNBALANCED, validation.errors.join('; '), validation.errors);
    }

    const journalId = crypto.randomUUID();
    const journalNumber = await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, req.session!.organization_id, 'JV', posting_date, 6);
      await tx.query(
        `INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, created_by, revision
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', 'PKR', $8, $9, $10, $11, 1)`,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          number,
          posting_date,
          document_date,
          accounting_purpose,
          validation.totalDebit.toFixed(8),
          validation.totalCredit.toFixed(8),
          description,
          req.session!.user_id,
        ],
      );
      for (const l of lines) {
        await tx.query(
          `INSERT INTO journal_lines (
            id, journal_id, line_number, account_id, debit_amount, credit_amount,
            currency, fx_rate, base_debit, base_credit, description
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', 1.0, $5, $6, $7)`,
          [crypto.randomUUID(), journalId, l.line_number, l.account_id, l.debit_amount, l.credit_amount, l.description || null],
        );
      }
      await auditLogger.record(
        {
          organization_id: req.session!.organization_id,
          user_id: req.session!.user_id,
          action: 'JOURNAL_DRAFT_CREATED',
          entity_type: 'JOURNAL',
          entity_id: journalId,
          after_state: { journal_number: number, lines: lines.length, total: validation.totalDebit.toFixed(2) },
          correlation_id: req.correlationId,
        },
        tx,
      );
      return number;
    });

    return ok(req, res, { id: journalId, journal_number: journalNumber, status: 'DRAFT', revision: 1 }, 201);
  });

  /** Optional optimistic revision check: stale approvals of an older version fail. */
  function expectedRevision(req: Request): number | null {
    const v = req.body?.expected_revision;
    return v === undefined || v === null ? null : int(v, 'expected_revision', { min: 1 });
  }

  async function journalTransition(req: Request, from: string[], to: string, action: string, extra: Record<string, unknown> = {}) {
    return db.transaction(async (tx) => {
      const j = await requireOrgRow(tx, 'journals', req.params.id, req.session!.organization_id, 'Journal entry', { forUpdate: true });
      const rev = expectedRevision(req);
      if (rev !== null && Number(j.revision) !== rev) {
        throw new ApiError(409, ErrorCode.STALE_REVISION, `Journal was changed (revision ${j.revision}); reload before continuing`, {
          current_revision: j.revision,
        });
      }
      if (to === JournalStatus.APPROVED && j.created_by === req.session!.user_id) {
        // PERMISSIONS-MATRIX segregation: journal creator vs reviewer.
        throw sodViolation('Segregation of duties: the journal creator cannot approve their own journal');
      }
      const updated = await transition(tx, {
        table: 'journals',
        id: j.id,
        organizationId: req.session!.organization_id,
        from,
        to,
        label: 'Journal',
        set: { revision: Number(j.revision) + 1, updated_at: new Date().toISOString(), ...extra },
      });
      await auditLogger.record(
        {
          organization_id: req.session!.organization_id,
          user_id: req.session!.user_id,
          action,
          entity_type: 'JOURNAL',
          entity_id: j.id,
          before_state: { status: j.status, revision: j.revision },
          after_state: { status: to, revision: updated.revision, reason: req.body?.reason || null },
          correlation_id: req.correlationId,
        },
        tx,
      );
      return updated;
    });
  }

  app.post('/api/journals/:id/submit', authenticate, requirePermission(Permission.FINANCE_JOURNAL_SUBMIT), async (req: Request, res: Response) => {
    const j = await journalTransition(req, [JournalStatus.DRAFT], JournalStatus.SUBMITTED, 'JOURNAL_SUBMITTED');
    return ok(req, res, { id: j.id, status: JournalStatus.SUBMITTED, revision: j.revision });
  });

  app.post('/api/journals/:id/approve', authenticate, requirePermission(Permission.FINANCE_JOURNAL_APPROVE), async (req: Request, res: Response) => {
    const j = await journalTransition(req, [JournalStatus.SUBMITTED], JournalStatus.APPROVED, 'JOURNAL_APPROVED', {
      approved_by: req.session!.user_id,
    });
    return ok(req, res, { id: j.id, status: JournalStatus.APPROVED, revision: j.revision });
  });

  /** Rejection returns a submitted journal to draft for revision (logic.md). */
  app.post('/api/journals/:id/reject', authenticate, requirePermission(Permission.FINANCE_JOURNAL_APPROVE), async (req: Request, res: Response) => {
    str(req.body?.reason, 'reason', { max: 500 });
    const j = await journalTransition(req, [JournalStatus.SUBMITTED, JournalStatus.APPROVED], JournalStatus.DRAFT, 'JOURNAL_REJECTED', {
      approved_by: null,
    });
    return ok(req, res, { id: j.id, status: JournalStatus.DRAFT, revision: j.revision });
  });

  app.post('/api/journals/:id/post', authenticate, requirePermission(Permission.FINANCE_JOURNAL_POST), async (req: Request, res: Response) => {
    const result = await db.transaction(async (tx) => {
      const j = await requireOrgRow(tx, 'journals', req.params.id, req.session!.organization_id, 'Journal entry', { forUpdate: true });
      if (j.status === JournalStatus.POSTED || j.status === JournalStatus.REVERSED) {
        throw new ApiError(400, ErrorCode.ALREADY_POSTED, 'This journal is already POSTED');
      }
      // Previously DRAFT journals could be posted directly, bypassing submit/approve.
      if (j.status !== JournalStatus.APPROVED) {
        throw new ApiError(409, ErrorCode.INVALID_STATE, `Only APPROVED journals can be posted (current status ${j.status})`);
      }
      const rev = expectedRevision(req);
      if (rev !== null && Number(j.revision) !== rev) {
        throw new ApiError(409, ErrorCode.STALE_REVISION, 'Journal was changed; reload before posting');
      }

      // Period guard (locked) + re-validation at execution time.
      const postingDate = toIsoDate(j.posting_date);
      const periodRes = await tx.query(
        `SELECT * FROM fiscal_periods WHERE organization_id = $1 AND legal_entity_id = $2 AND start_date <= $3::date AND end_date >= $3::date FOR UPDATE`,
        [req.session!.organization_id, j.legal_entity_id, postingDate],
      );
      const period = periodRes.rows[0] || null;
      if (!period) throw new ApiError(400, ErrorCode.PERIOD_CLOSED, `No defined fiscal period found for business posting date ${postingDate}`);
      if (period.status !== 'OPEN') {
        throw new ApiError(400, ErrorCode.PERIOD_CLOSED, `Posting rejected: Fiscal period ${period.period_name} is ${period.status}`);
      }

      const linesRes = await tx.query<JournalLine>('SELECT * FROM journal_lines WHERE journal_id = $1', [j.id]);
      const accountsRes = await tx.query<Account>('SELECT * FROM accounts WHERE organization_id = $1', [req.session!.organization_id]);
      const validation = JournalValidator.validate(linesRes.rows, new Map(accountsRes.rows.map((a) => [a.id, a])));
      if (!validation.isValid) {
        throw new ApiError(400, ErrorCode.JOURNAL_UNBALANCED, validation.errors.join('; '), validation.errors);
      }

      await tx.query(
        `UPDATE journals SET status = 'POSTED', posted_by = $1, posted_at = CURRENT_TIMESTAMP, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND organization_id = $3 AND status = 'APPROVED'`,
        [req.session!.user_id, j.id, req.session!.organization_id],
      );
      await outboxService.emit(
        {
          organization_id: req.session!.organization_id,
          event_type: 'JOURNAL_POSTED',
          payload: { journal_id: j.id, journal_number: j.journal_number, total_base_debit: j.total_base_debit, posted_by: req.session!.user_id },
        },
        tx,
      );
      await auditLogger.record(
        {
          organization_id: req.session!.organization_id,
          user_id: req.session!.user_id,
          action: 'JOURNAL_POSTED',
          entity_type: 'JOURNAL',
          entity_id: j.id,
          before_state: { status: j.status },
          after_state: { status: JournalStatus.POSTED, posted_by: req.session!.user_id },
          correlation_id: req.correlationId,
        },
        tx,
      );
      return j;
    });

    return ok(req, res, { id: result.id, status: JournalStatus.POSTED, journal_number: result.journal_number });
  });

  app.post('/api/journals/:id/reverse', authenticate, requirePermission(Permission.FINANCE_JOURNAL_REVERSE), async (req: Request, res: Response) => {
    const reversal_posting_date = dateOnly(req.body?.reversal_posting_date, 'reversal_posting_date');
    const reason = str(req.body?.reason, 'reason', { max: 500 });

    const out = await db.transaction(async (tx) => {
      const originalJournal = (await requireOrgRow(tx, 'journals', req.params.id, req.session!.organization_id, 'Journal', {
        forUpdate: true,
      })) as Journal;
      const linesRes = await tx.query<JournalLine>('SELECT * FROM journal_lines WHERE journal_id = $1 ORDER BY line_number', [originalJournal.id]);
      originalJournal.lines = linesRes.rows;
      const origDate = toIsoDate(originalJournal.posting_date);
      if (reversal_posting_date < origDate) {
        throw validationError('Reversal date cannot be earlier than the original posting date', { field: 'reversal_posting_date' });
      }

      let reversalData: ReturnType<typeof JournalReversalEngine.createLinkedReversal>;
      try {
        reversalData = JournalReversalEngine.createLinkedReversal({
          originalJournal,
          reversalPostingDate: reversal_posting_date,
          reversalDocumentDate: reversal_posting_date,
          reason,
          reversingUserId: req.session!.user_id,
        });
      } catch (err: any) {
        throw new ApiError(400, ErrorCode.ALREADY_REVERSED, err.message);
      }
      const rev = reversalData.reversalJournal;

      // Goes through the posting engine: period guard, leaf/active accounts, balance.
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session!.organization_id,
        legalEntityId: originalJournal.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: reversal_posting_date,
        purpose: AccountingPurpose.REVERSAL,
        description: rev.description,
        sourceType: 'JOURNAL',
        sourceId: originalJournal.id,
        sourceKey: `REVERSAL:${originalJournal.id}`,
        journalNumber: rev.journal_number,
        reversalOfJournalId: originalJournal.id,
        correlationId: req.correlationId,
        lines: rev.lines.map((l) => ({
          account_id: l.account_id,
          debit: String(l.base_debit),
          credit: String(l.base_credit),
          description: l.description,
          party_id: l.party_id,
          project_id: l.dimension_project_id,
          cost_center_id: l.dimension_cost_center_id,
          branch_id: l.dimension_branch_id,
        })),
      });
      if (!posted) throw validationError('Journal has no non-zero lines to reverse');

      await tx.query(
        `UPDATE journals SET reversed_by_journal_id = $1, status = 'REVERSED', updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND organization_id = $3`,
        [posted.journalId, originalJournal.id, req.session!.organization_id],
      );
      await auditLogger.record(
        {
          organization_id: req.session!.organization_id,
          user_id: req.session!.user_id,
          action: 'JOURNAL_REVERSED',
          entity_type: 'JOURNAL',
          entity_id: originalJournal.id,
          after_state: { reversalJournalId: posted.journalId, reason },
          correlation_id: req.correlationId,
        },
        tx,
      );
      return { original_journal_id: originalJournal.id, reversal_journal_id: posted.journalId };
    });

    return ok(req, res, { ...out, status: JournalStatus.REVERSED }, 201);
  });

  // ==========================================
  // 6. General Ledger & Trial Balance
  // ==========================================
  app.get('/api/ledger/trial-balance', authenticate, requirePermission(Permission.FINANCE_REPORTS_VIEW), async (req: Request, res: Response) => {
    const asOfDate = dateOnly(req.query.as_of_date, 'as_of_date', { defaultValue: todayIso() });
    const accountsRes = await db.query<Account>('SELECT * FROM accounts WHERE organization_id = $1 ORDER BY code ASC', [
      req.session!.organization_id,
    ]);
    const postedLinesRes = await db.query<JournalLine>(
      `SELECT jl.* FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
       WHERE j.organization_id = $1 AND j.status IN ('POSTED', 'REVERSED') AND j.posting_date <= $2`,
      [req.session!.organization_id, asOfDate],
    );
    const report = LedgerEngine.computeTrialBalance(accountsRes.rows, postedLinesRes.rows, asOfDate, req.session!.legal_entity_id, 'PKR');
    return ok(req, res, report);
  });

  /** Account ledger drill-down: every posted line for an account with running balance. */
  app.get('/api/ledger/accounts/:id', authenticate, requirePermission(Permission.FINANCE_REPORTS_VIEW), async (req: Request, res: Response) => {
    const account = await requireOrgRow<Account>(db, 'accounts', req.params.id, req.session!.organization_id, 'Account');
    const from = dateOnly(req.query.from, 'from', { defaultValue: '1900-01-01' });
    const to = dateOnly(req.query.to, 'to', { defaultValue: todayIso() });
    const lines = await db.query(
      `SELECT j.id AS journal_id, j.journal_number, j.posting_date, j.accounting_purpose, j.description AS journal_description,
              jl.line_number, jl.base_debit, jl.base_credit, jl.description
       FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
       WHERE j.organization_id = $1 AND jl.account_id = $2 AND j.status IN ('POSTED','REVERSED')
         AND j.posting_date BETWEEN $3 AND $4
       ORDER BY j.posting_date ASC, j.created_at ASC, jl.line_number ASC
       LIMIT 5000`,
      [req.session!.organization_id, account.id, from, to],
    );
    let running = Money.zero();
    const debitNormal = account.normal_balance === 'DEBIT';
    const rows = lines.rows.map((l: any) => {
      const delta = new Money(l.base_debit).sub(l.base_credit);
      running = running.add(debitNormal ? delta : delta.negated());
      return { ...l, running_balance: running.toFixed(2) };
    });
    return ok(req, res, { account, from, to, lines: rows, closing_balance: running.toFixed(2) });
  });
}
