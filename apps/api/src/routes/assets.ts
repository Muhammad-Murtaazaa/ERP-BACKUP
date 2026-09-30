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

export function registerAssetsRoutes(app: Express): void {
  // 21. Fixed Assets & Depreciation Engine (M7)
  // ==========================================

  // Asset Categories
  app.get('/api/assets/categories', authenticate, requirePermission(Permission.FINANCE_COA_VIEW), async (req: Request, res: Response) => {
    const result = await db.query(
      'SELECT * FROM asset_categories WHERE organization_id = $1 ORDER BY code ASC',
      [req.session!.organization_id]
    );
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/assets/categories', authenticate, requirePermission(Permission.ASSET_MANAGE), async (req: Request, res: Response) => {
    const {
      code,
      name,
      depreciation_method,
      useful_life_months,
      salvage_value_percentage,
      asset_cost_account_id,
      accumulated_deprec_account_id,
      deprec_expense_account_id,
    } = req.body;

    if (!code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Code and name are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO asset_categories (
        id, code, name, depreciation_method, useful_life_months, salvage_value_percentage,
        asset_cost_account_id, accumulated_deprec_account_id, deprec_expense_account_id, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        code,
        name,
        depreciation_method || 'STRAIGHT_LINE',
        useful_life_months || 60,
        salvage_value_percentage || 0.0,
        asset_cost_account_id || null,
        accumulated_deprec_account_id || null,
        deprec_expense_account_id || null,
        req.session!.organization_id,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, code, name },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Fixed Assets Register
  app.get('/api/assets', authenticate, requirePermission(Permission.FINANCE_REPORTS_VIEW), async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT fa.*, ac.name as category_name 
       FROM fixed_assets fa 
       JOIN asset_categories ac ON ac.id = fa.category_id 
       WHERE fa.organization_id = $1 
       ORDER BY fa.asset_number ASC`,
      [req.session!.organization_id]
    );
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/assets', authenticate, requirePermission(Permission.ASSET_MANAGE), async (req: Request, res: Response) => {
    const {
      asset_number,
      name,
      category_id,
      acquisition_date,
      acquisition_cost,
      salvage_value,
      useful_life_months,
      depreciation_method,
      location,
      custodian_name,
      serial_number,
    } = req.body;

    if (!asset_number || !name || !category_id || !acquisition_cost) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Asset number, name, category_id, and acquisition_cost are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const cost = new Money(acquisition_cost).toFixed(8);
    const salvage = new Money(salvage_value || '0').toFixed(8);
    const id = crypto.randomUUID();

    await db.query(
      `INSERT INTO fixed_assets (
        id, asset_number, name, category_id, acquisition_date, acquisition_cost,
        salvage_value, useful_life_months, depreciation_method, status,
        location, custodian_name, serial_number, current_book_value, accumulated_depreciation, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, $11, $12, $13, '0.00000000', $14)`,
      [
        id,
        asset_number,
        name,
        category_id,
        acquisition_date || new Date().toISOString().slice(0, 10),
        cost,
        salvage,
        useful_life_months || 60,
        depreciation_method || 'STRAIGHT_LINE',
        location || null,
        custodian_name || null,
        serial_number || null,
        cost,
        req.session!.organization_id,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, asset_number, name, acquisition_cost: cost, status: 'ACTIVE' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Run Monthly Asset Depreciation
  app.post('/api/assets/:id/depreciate', authenticate, requirePermission(Permission.ASSET_DEPRECIATE), async (req: Request, res: Response) => {
    const { id } = req.params;
    const { period_id, period_months } = req.body;

    const assetRes = await db.query(
      `SELECT fa.*, ac.deprec_expense_account_id, ac.accumulated_deprec_account_id 
       FROM fixed_assets fa 
       JOIN asset_categories ac ON ac.id = fa.category_id 
       WHERE fa.id = $1 AND fa.organization_id = $2`,
      [id, req.session!.organization_id]
    );

    if (assetRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Fixed asset not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const asset = assetRes.rows[0];
    if (asset.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.ASSET_NOT_ACTIVE, message: `Asset is in status ${asset.status}, not eligible for depreciation`, correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    // Look up accounts:
    let expenseAccountId = asset.deprec_expense_account_id;
    let accumulatedAccountId = asset.accumulated_deprec_account_id;

    if (!expenseAccountId || !accumulatedAccountId) {
      const accRes = await db.query(
        `SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('521004', '121002')`,
        [req.session!.organization_id]
      );
      const map = new Map<string, string>(accRes.rows.map((r) => [r.code, r.id]));
      expenseAccountId = expenseAccountId || map.get('521004');
      accumulatedAccountId = accumulatedAccountId || map.get('121002');
    }

    if (!expenseAccountId || !accumulatedAccountId) {
      return res.status(422).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Depreciation expense or accumulated depreciation account not configured', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const calc = FixedAssetsEngine.calculateDepreciation(
      asset.acquisition_cost,
      asset.accumulated_depreciation,
      asset.salvage_value,
      asset.useful_life_months,
      asset.depreciation_method,
      period_months || 1
    );

    if (new Money(calc.depreciation_amount).isZero()) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Asset is already fully depreciated down to salvage value', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const today = new Date().toISOString().slice(0, 10);
    const journalDraft = FixedAssetsEngine.generateDepreciationJournal({
      organization_id: req.session!.organization_id,
      legal_entity_id: req.session!.legal_entity_id,
      period_id: period_id || '',
      posting_date: today,
      asset_number: asset.asset_number,
      asset_name: asset.name,
      depreciation_amount: calc.depreciation_amount,
      expense_account_id: expenseAccountId,
      accumulated_account_id: accumulatedAccountId,
    });

    const journalId = crypto.randomUUID();
    const entryId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      // Insert journal
      await tx.query(
        `INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, source_type, source_id, created_by, posted_by, posted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', 'PKR', $8, $9, $10, 'FIXED_ASSET', $11, $12, $12, CURRENT_TIMESTAMP)`,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          journalDraft.journal_number,
          today,
          today,
          journalDraft.accounting_purpose,
          calc.depreciation_amount,
          calc.depreciation_amount,
          journalDraft.description,
          id,
          req.session!.user_id,
        ]
      );

      // Insert journal lines
      for (const line of journalDraft.lines) {
        await tx.query(
          `INSERT INTO journal_lines (
            id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate, base_debit, base_credit, description
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', '1.000000000000', $7, $8, $9)`,
          [
            crypto.randomUUID(),
            journalId,
            line.line_number,
            line.account_id,
            line.debit_amount,
            line.credit_amount,
            line.base_debit,
            line.base_credit,
            line.description,
          ]
        );
      }

      // Insert depreciation entry
      await tx.query(
        `INSERT INTO asset_depreciation_entries (
          id, asset_id, period_id, entry_date, depreciation_amount, accumulated_depreciation_after, book_value_after, journal_id, organization_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entryId,
          id,
          period_id || null,
          today,
          calc.depreciation_amount,
          calc.accumulated_depreciation_after,
          calc.book_value_after,
          journalId,
          req.session!.organization_id,
        ]
      );

      // Update fixed asset
      const newStatus = new Money(calc.book_value_after).equals(new Money(asset.salvage_value)) ? 'FULLY_DEPRECIATED' : 'ACTIVE';
      await tx.query(
        `UPDATE fixed_assets 
         SET accumulated_depreciation = $1, current_book_value = $2, status = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $4`,
        [calc.accumulated_depreciation_after, calc.book_value_after, newStatus, id]
      );
    });

    return res.json({
      success: true,
      data: {
        id,
        depreciation_amount: calc.depreciation_amount,
        accumulated_depreciation: calc.accumulated_depreciation_after,
        current_book_value: calc.book_value_after,
        journal_id: journalId,
      },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Fixed Asset Disposal / Retirement
  app.post('/api/assets/:id/dispose', authenticate, requirePermission(Permission.ASSET_DISPOSE), async (req: Request, res: Response) => {
    const { id } = req.params;
    const { proceeds, disposal_date } = req.body;

    const assetRes = await db.query(
      `SELECT fa.*, ac.asset_cost_account_id, ac.accumulated_deprec_account_id 
       FROM fixed_assets fa 
       JOIN asset_categories ac ON ac.id = fa.category_id 
       WHERE fa.id = $1 AND fa.organization_id = $2`,
      [id, req.session!.organization_id]
    );

    if (assetRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Fixed asset not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const asset = assetRes.rows[0];
    if (asset.status === 'DISPOSED' || asset.status === 'WRITTEN_OFF') {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.ASSET_ALREADY_DISPOSED, message: 'Asset is already disposed or written off', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    // Look up accounts:
    const accRes = await db.query(
      `SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('121001', '121002', '111002', '411002', '511001')`,
      [req.session!.organization_id]
    );
    const map = new Map<string, string>(accRes.rows.map((r) => [r.code, r.id]));

    const costAcc = asset.asset_cost_account_id || map.get('121001');
    const accumAcc = asset.accumulated_deprec_account_id || map.get('121002');
    const bankAcc = map.get('111002');
    const gainAcc = map.get('411002');
    const lossAcc = map.get('511001');

    if (!costAcc || !accumAcc || !bankAcc || !gainAcc || !lossAcc) {
      return res.status(422).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Required COA accounts not found for disposal settlement', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const today = disposal_date || new Date().toISOString().slice(0, 10);
    const proceedsStr = new Money(proceeds || '0').toFixed(8);

    const journalDraft = FixedAssetsEngine.generateDisposalJournal({
      organization_id: req.session!.organization_id,
      legal_entity_id: req.session!.legal_entity_id,
      period_id: '',
      posting_date: today,
      asset_number: asset.asset_number,
      asset_name: asset.name,
      acquisition_cost: asset.acquisition_cost,
      accumulated_depreciation: asset.accumulated_depreciation,
      proceeds: proceedsStr,
      asset_cost_account_id: costAcc,
      accumulated_deprec_account_id: accumAcc,
      bank_account_id: bankAcc,
      gain_account_id: gainAcc,
      loss_account_id: lossAcc,
    });

    const journalId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      let totalDebit = Money.zero();
      let totalCredit = Money.zero();
      for (const l of journalDraft.lines) {
        totalDebit = totalDebit.add(new Money(l.base_debit));
        totalCredit = totalCredit.add(new Money(l.base_credit));
      }

      // Insert journal
      await tx.query(
        `INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, source_type, source_id, created_by, posted_by, posted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', 'PKR', $8, $9, $10, 'FIXED_ASSET', $11, $12, $12, CURRENT_TIMESTAMP)`,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          journalDraft.journal_number,
          today,
          today,
          journalDraft.accounting_purpose,
          totalDebit.format(),
          totalCredit.format(),
          journalDraft.description,
          id,
          req.session!.user_id,
        ]
      );

      // Insert journal lines
      for (const line of journalDraft.lines) {
        await tx.query(
          `INSERT INTO journal_lines (
            id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate, base_debit, base_credit, description
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', '1.000000000000', $7, $8, $9)`,
          [
            crypto.randomUUID(),
            journalId,
            line.line_number,
            line.account_id,
            line.debit_amount,
            line.credit_amount,
            line.base_debit,
            line.base_credit,
            line.description,
          ]
        );
      }

      // Update fixed asset
      await tx.query(
        `UPDATE fixed_assets 
         SET status = 'DISPOSED', disposal_date = $1, disposal_proceeds = $2, disposal_journal_id = $3, current_book_value = '0.00000000', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $4`,
        [today, proceedsStr, journalId, id]
      );
    });

    return res.json({
      success: true,
      data: { id, status: 'DISPOSED', disposal_proceeds: proceedsStr, journal_id: journalId },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
}
