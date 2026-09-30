/* eslint-disable */
import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  PGliteAdapter,
  DbMigrator,
  SyntheticSeedRunner,
  AuthService,
  AuditLogger,
  OutboxService,
} from '@omnysync/platform';
import {
  Money,
  JournalValidator,
  CoaHierarchyValidator,
  PeriodManager,
  LedgerEngine,
  JournalReversalEngine,
  BankReconciliationEngine,
  FxEngine,
  PayrollEngine,
  ManufacturingEngine,
  InventoryReconciliationEngine,
  ProjectsEngine,
  FixedAssetsEngine,
  POSEngine,
  QualityEngine,
  MaintenanceEngine,
} from '@omnysync/financial-engine';
import {
  ErrorCode,
  StandardErrorResponse,
  StandardSuccessResponse,
  AuthSession,
  UserRole,
  Permission,
  JournalStatus,
  AccountingPurpose,
  PeriodStatus,
  Account,
  Journal,
  JournalLine,
} from '@omnysync/contracts';

import { db, authService, auditLogger, outboxService, authenticate, requirePermission } from '../context.js';

export function registerTreasuryRoutes(app: Express): void {
  // 14. M3: Multi-Currency & FX Engine
  // ==========================================
  app.get('/api/fx/rates', authenticate, async (req: Request, res: Response) => {
    const ratesRes = await db.query(
      'SELECT * FROM exchange_rates WHERE organization_id = $1 ORDER BY effective_date DESC, from_currency ASC',
      [req.session!.organization_id],
    );

    return res.json({
      success: true,
      data: ratesRes.rows,
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        total_count: ratesRes.rows.length,
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/fx/rates', authenticate, requirePermission(Permission.TREASURY_FX_MANAGE), async (req: Request, res: Response) => {
    const { from_currency, to_currency, rate, effective_date, source } = req.body;

    if (!from_currency || !to_currency || !rate || !effective_date) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'from_currency, to_currency, rate, and effective_date are required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    await db.query(
      `
      INSERT INTO exchange_rates (
        id, organization_id, from_currency, to_currency, rate, effective_date, source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (organization_id, from_currency, to_currency, effective_date)
      DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source
    `,
      [id, req.session!.organization_id, from_currency.toUpperCase(), to_currency.toUpperCase(), rate, effective_date, source || 'MANUAL'],
    );

    return res.status(201).json({
      success: true,
      data: { id, from_currency, to_currency, rate, effective_date },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
  // 15. M3: Treasury & Bank Statement Reconciliation
  // ==========================================
  app.get('/api/treasury/statements', authenticate, async (req: Request, res: Response) => {
    const stmtsRes = await db.query(
      `
      SELECT bs.*, a.name as bank_account_name, a.code as bank_account_code,
        (SELECT COUNT(*) FROM bank_statement_lines bsl WHERE bsl.statement_id = bs.id) as total_lines,
        (SELECT COUNT(*) FROM bank_statement_lines bsl WHERE bsl.statement_id = bs.id AND bsl.is_matched = true) as matched_lines
      FROM bank_statements bs
      JOIN accounts a ON a.id = bs.bank_account_id
      WHERE bs.organization_id = $1
      ORDER BY bs.statement_date DESC, bs.created_at DESC
    `,
      [req.session!.organization_id],
    );

    return res.json({
      success: true,
      data: stmtsRes.rows,
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        total_count: stmtsRes.rows.length,
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.get('/api/treasury/statements/:id', authenticate, async (req: Request, res: Response) => {
    const { id } = req.params;

    const stmtRes = await db.query(
      `
      SELECT bs.*, a.name as bank_account_name, a.code as bank_account_code
      FROM bank_statements bs
      JOIN accounts a ON a.id = bs.bank_account_id
      WHERE bs.id = $1 AND bs.organization_id = $2
    `,
      [id, req.session!.organization_id],
    );

    if (stmtRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'Bank statement not found',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const statement = stmtRes.rows[0];
    const linesRes = await db.query(
      'SELECT * FROM bank_statement_lines WHERE statement_id = $1 ORDER BY line_number ASC',
      [id],
    );

    // Fetch un-reconciled GL journal lines for this bank account
    const glRes = await db.query(
      `
      SELECT jl.*, j.journal_number, j.posting_date
      FROM journal_lines jl
      JOIN journals j ON j.id = jl.journal_id
      WHERE jl.account_id = $1 AND j.status = 'POSTED' AND j.organization_id = $2
      ORDER BY j.posting_date ASC
    `,
      [statement.bank_account_id, req.session!.organization_id],
    );

    // Calculate current bank balance from GL
    let glBalance = Money.zero();
    for (const l of glRes.rows) {
      glBalance = glBalance.add(l.base_debit).sub(l.base_credit);
    }

    const summary = BankReconciliationEngine.computeReconciliation({
      statementOpeningBalance: statement.opening_balance,
      statementClosingBalance: statement.closing_balance,
      glBalanceAsOfDate: glBalance.toFixed(8),
      statementLines: linesRes.rows,
    });

    return res.json({
      success: true,
      data: {
        ...statement,
        lines: linesRes.rows,
        summary,
        unreconciled_gl_lines: glRes.rows,
      },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/treasury/statements/upload', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
    const { bank_account_id, statement_reference, statement_date, opening_balance, closing_balance, lines } = req.body;

    if (!bank_account_id || !statement_reference || !statement_date || !lines || lines.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'bank_account_id, statement_reference, statement_date, and lines are required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const statementId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.query(
        `
        INSERT INTO bank_statements (
          id, organization_id, legal_entity_id, bank_account_id, statement_reference,
          statement_date, opening_balance, closing_balance, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UPLOADED', $9)
      `,
        [
          statementId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          bank_account_id,
          statement_reference,
          statement_date,
          opening_balance || '0.00',
          closing_balance || '0.00',
          req.session!.user_id,
        ],
      );

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const lineId = crypto.randomUUID();
        await tx.query(
          `
          INSERT INTO bank_statement_lines (
            id, statement_id, line_number, transaction_date, value_date, amount, reference, description, is_matched
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
        `,
          [lineId, statementId, i + 1, l.transaction_date, l.value_date || l.transaction_date, l.amount, l.reference || null, l.description || null],
        );
      }
    });

    return res.status(201).json({
      success: true,
      data: { id: statementId, statement_reference, status: 'UPLOADED', lines_count: lines.length },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/treasury/reconciliation/match', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
    const { statement_line_id, journal_line_id, is_matched } = req.body;

    if (!statement_line_id) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'statement_line_id is required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    await db.query(
      `
      UPDATE bank_statement_lines
      SET is_matched = $1, matched_journal_line_id = $2
      WHERE id = $3
    `,
      [is_matched !== false, journal_line_id || null, statement_line_id],
    );

    return res.json({
      success: true,
      data: { statement_line_id, is_matched: is_matched !== false, journal_line_id },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/treasury/reconciliation/sign-off', authenticate, requirePermission(Permission.TREASURY_BANK_RECONCILE), async (req: Request, res: Response) => {
    const { statement_id, notes } = req.body;

    const stmtRes = await db.query('SELECT * FROM bank_statements WHERE id = $1 AND organization_id = $2', [
      statement_id,
      req.session!.organization_id,
    ]);
    if (stmtRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'Bank statement not found',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const statement = stmtRes.rows[0];
    const linesRes = await db.query('SELECT * FROM bank_statement_lines WHERE statement_id = $1', [statement_id]);

    const unmatched = linesRes.rows.filter((l: any) => !l.is_matched);
    if (unmatched.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.RECONCILIATION_MISMATCH,
          message: `Cannot sign off: ${unmatched.length} statement line(s) remain unmatched`,
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const reconId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.query("UPDATE bank_statements SET status = 'RECONCILED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [statement_id]);

      await tx.query(
        `
        INSERT INTO bank_reconciliations (
          id, statement_id, reconciled_date, statement_closing_balance, gl_closing_balance,
          unreconciled_difference, status, reconciled_by, notes
        ) VALUES ($1, $2, CURRENT_DATE, $3, $3, 0, 'COMPLETED', $4, $5)
      `,
        [reconId, statement_id, statement.closing_balance, req.session!.user_id, notes || null],
      );

      await auditLogger.record(
        {
          organization_id: req.session!.organization_id,
          user_id: req.session!.user_id,
          action: 'BANK_STATEMENT_RECONCILED',
          entity_type: 'BANK_STATEMENT',
          entity_id: statement_id,
          after_state: { status: 'RECONCILED', statement_reference: statement.statement_reference },
          correlation_id: req.correlationId,
        },
        tx,
      );
    });

    return res.json({
      success: true,
      data: { statement_id, status: 'RECONCILED', reconciliation_id: reconId },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
  // 16. M3: Onboarding & Industry Template Provisioning
  // ==========================================
  app.get('/api/onboarding/profile', authenticate, async (req: Request, res: Response) => {
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
