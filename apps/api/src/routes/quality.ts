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

export function registerQualityRoutes(app: Express): void {
  // 23. Quality Management (QM) Module (M8)
  // ==========================================

  // Inspection Plans
  app.get('/api/quality/plans', authenticate, requirePermission(Permission.QUALITY_PLAN_MANAGE), async (req: Request, res: Response) => {
    const plansRes = await db.query(
      `SELECT qp.*, i.name as item_name, i.code as item_code 
       FROM quality_inspection_plans qp 
       LEFT JOIN items i ON i.id = qp.item_id 
       WHERE qp.organization_id = $1 
       ORDER BY qp.plan_code ASC`,
      [req.session!.organization_id]
    );

    const paramsRes = await db.query(
      `SELECT qpp.* 
       FROM quality_inspection_plan_params qpp 
       JOIN quality_inspection_plans qp ON qp.id = qpp.plan_id 
       WHERE qp.organization_id = $1 
       ORDER BY qpp.created_at ASC`,
      [req.session!.organization_id]
    );

    const paramsByPlan = new Map<string, any[]>();
    for (const p of paramsRes.rows) {
      if (!paramsByPlan.has(p.plan_id)) paramsByPlan.set(p.plan_id, []);
      paramsByPlan.get(p.plan_id)!.push(p);
    }

    const plans = plansRes.rows.map((plan) => ({
      ...plan,
      params: paramsByPlan.get(plan.id) || [],
    }));

    return res.json({
      success: true,
      data: plans,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/quality/plans', authenticate, requirePermission(Permission.QUALITY_PLAN_MANAGE), async (req: Request, res: Response) => {
    const { plan_code, name, item_id, inspection_type, sample_size, params } = req.body;

    if (!plan_code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'plan_code and name are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const planId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO quality_inspection_plans (
          id, organization_id, plan_code, name, item_id, inspection_type, sample_size, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')`,
        [
          planId,
          req.session!.organization_id,
          plan_code,
          name,
          item_id || null,
          inspection_type || 'RECEIVING',
          sample_size || '1.00000000',
        ]
      );

      if (Array.isArray(params)) {
        for (const p of params) {
          await tx.query(
            `INSERT INTO quality_inspection_plan_params (
              id, plan_id, param_name, data_type, target_value, min_tolerance, max_tolerance, uom, is_mandatory
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              crypto.randomUUID(),
              planId,
              p.param_name,
              p.data_type || 'NUMERIC',
              p.target_value || null,
              p.min_tolerance !== undefined ? p.min_tolerance : null,
              p.max_tolerance !== undefined ? p.max_tolerance : null,
              p.uom || null,
              p.is_mandatory !== undefined ? p.is_mandatory : true,
            ]
          );
        }
      }
    });

    return res.status(201).json({
      success: true,
      data: { id: planId, plan_code, name, status: 'ACTIVE' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Inspection Lots
  app.get('/api/quality/lots', authenticate, requirePermission(Permission.QUALITY_INSPECT), async (req: Request, res: Response) => {
    const lotsRes = await db.query(
      `SELECT ql.*, i.name as item_name, i.code as item_code, u.name as inspector_name 
       FROM quality_inspection_lots ql 
       JOIN items i ON i.id = ql.item_id 
       LEFT JOIN users u ON u.id = ql.inspector_id 
       WHERE ql.organization_id = $1 
       ORDER BY ql.created_at DESC`,
      [req.session!.organization_id]
    );

    const resultsRes = await db.query(
      `SELECT qr.* 
       FROM quality_inspection_results qr 
       JOIN quality_inspection_lots ql ON ql.id = qr.lot_id 
       WHERE ql.organization_id = $1`,
      [req.session!.organization_id]
    );

    const resultsByLot = new Map<string, any[]>();
    for (const r of resultsRes.rows) {
      if (!resultsByLot.has(r.lot_id)) resultsByLot.set(r.lot_id, []);
      resultsByLot.get(r.lot_id)!.push(r);
    }

    const lots = lotsRes.rows.map((lot) => ({
      ...lot,
      results: resultsByLot.get(lot.id) || [],
    }));

    return res.json({
      success: true,
      data: lots,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/quality/lots', authenticate, requirePermission(Permission.QUALITY_INSPECT), async (req: Request, res: Response) => {
    const { lot_number, source_type, source_id, item_id, batch_number, quantity } = req.body;

    if (!item_id || !quantity) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'item_id and quantity are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    const lotNum = lot_number || `LOT-${Date.now().toString().slice(-6)}`;
    const qtyStr = new Money(quantity).toFixed(8);

    await db.query(
      `INSERT INTO quality_inspection_lots (
        id, organization_id, legal_entity_id, lot_number, source_type, source_id, item_id, batch_number, quantity, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')`,
      [
        id,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        lotNum,
        source_type || 'MANUAL',
        source_id || null,
        item_id,
        batch_number || null,
        qtyStr,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, lot_number: lotNum, item_id, quantity: qtyStr, status: 'PENDING' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Record Inspection Measurements & Evaluate Usage Decision
  app.post('/api/quality/lots/:id/inspect', authenticate, requirePermission(Permission.QUALITY_INSPECT), async (req: Request, res: Response) => {
    const { id } = req.params;
    const { results, usage_decision_notes } = req.body;

    const lotRes = await db.query(
      `SELECT * FROM quality_inspection_lots WHERE id = $1 AND organization_id = $2`,
      [id, req.session!.organization_id]
    );
    if (lotRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.LOT_NOT_FOUND, message: 'Inspection lot not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const lot = lotRes.rows[0];

    // Fetch inspection plan parameters for this item if available
    const planParamsRes = await db.query(
      `SELECT qpp.* 
       FROM quality_inspection_plan_params qpp 
       JOIN quality_inspection_plans qp ON qp.id = qpp.plan_id 
       WHERE qp.item_id = $1 AND qp.organization_id = $2 AND qp.status = 'ACTIVE'`,
      [lot.item_id, req.session!.organization_id]
    );

    const evaluation = QualityEngine.evaluateLot(
      planParamsRes.rows,
      results || []
    );

    await db.transaction(async (tx) => {
      // Delete existing results for lot
      await tx.query(`DELETE FROM quality_inspection_results WHERE lot_id = $1`, [id]);

      // Insert new evaluated results
      for (const r of evaluation.evaluated_results) {
        await tx.query(
          `INSERT INTO quality_inspection_results (
            id, lot_id, param_name, measured_numeric_value, measured_text_value, is_pass, inspector_notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            crypto.randomUUID(),
            id,
            r.param_name,
            r.measured_numeric_value || null,
            r.measured_text_value || null,
            r.is_pass,
            r.inspector_notes || null,
          ]
        );
      }

      // Update lot status and inspector
      await tx.query(
        `UPDATE quality_inspection_lots 
         SET status = $1, usage_decision_notes = $2, inspector_id = $3, inspected_at = NOW(), updated_at = NOW() 
         WHERE id = $4`,
        [evaluation.overall_status, usage_decision_notes || null, req.session!.user_id, id]
      );
    });

    return res.json({
      success: true,
      data: {
        id,
        status: evaluation.overall_status,
        all_mandatory_passed: evaluation.all_mandatory_passed,
        results: evaluation.evaluated_results,
      },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Non-Conformance Reports (NCR)
  app.get('/api/quality/ncr', authenticate, requirePermission(Permission.QUALITY_NCR_MANAGE), async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT ncr.*, ql.lot_number, i.name as item_name, i.code as item_code 
       FROM quality_non_conformance_reports ncr 
       JOIN quality_inspection_lots ql ON ql.id = ncr.lot_id 
       JOIN items i ON i.id = ncr.item_id 
       WHERE ncr.organization_id = $1 
       ORDER BY ncr.created_at DESC`,
      [req.session!.organization_id]
    );
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/quality/ncr', authenticate, requirePermission(Permission.QUALITY_NCR_MANAGE), async (req: Request, res: Response) => {
    const { lot_id, defect_severity, root_cause, corrective_action, disposition } = req.body;

    if (!lot_id) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'lot_id is required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const lotRes = await db.query(`SELECT item_id FROM quality_inspection_lots WHERE id = $1`, [lot_id]);
    if (lotRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.LOT_NOT_FOUND, message: 'Inspection lot not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    const ncrNum = `NCR-${Date.now().toString().slice(-6)}`;

    await db.query(
      `INSERT INTO quality_non_conformance_reports (
        id, organization_id, ncr_number, lot_id, item_id, defect_severity, root_cause, corrective_action, disposition, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN', $10)`,
      [
        id,
        req.session!.organization_id,
        ncrNum,
        lot_id,
        lotRes.rows[0].item_id,
        defect_severity || 'MAJOR',
        root_cause || null,
        corrective_action || null,
        disposition || 'REWORK',
        req.session!.user_id,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, ncr_number: ncrNum, status: 'OPEN', disposition: disposition || 'REWORK' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Scrap Authorization & GL Settlement for Defective Lot
  app.post('/api/quality/ncr/:id/scrap', authenticate, requirePermission(Permission.QUALITY_NCR_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;

    const ncrRes = await db.query(
      `SELECT ncr.*, ql.quantity, ql.lot_number, i.code as item_code, i.name as item_name, i.unit_cost 
       FROM quality_non_conformance_reports ncr 
       JOIN quality_inspection_lots ql ON ql.id = ncr.lot_id 
       JOIN items i ON i.id = ncr.item_id 
       WHERE ncr.id = $1 AND ncr.organization_id = $2`,
      [id, req.session!.organization_id]
    );
    if (ncrRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.NCR_NOT_FOUND, message: 'NCR not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const ncr = ncrRes.rows[0];
    if (ncr.status === 'CLOSED') {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.NCR_ALREADY_CLOSED, message: 'NCR is already closed', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    // Look up COA accounts: 511003 (Manufacturing Scrap & Variance) and 113002/113001 (Raw Materials / Inventory)
    const accRes = await db.query(
      `SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('511003', '113002', '113001')`,
      [req.session!.organization_id]
    );
    const map = new Map<string, string>(accRes.rows.map((r) => [r.code, r.id]));
    const scrapAcc = map.get('511003');
    const invAcc = map.get('113002') || map.get('113001');

    if (!scrapAcc || !invAcc) {
      return res.status(422).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Required COA accounts (511003/113002) not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const today = new Date().toISOString().slice(0, 10);
    const scrapJournalDraft = QualityEngine.generateScrapWriteOffJournal({
      organization_id: req.session!.organization_id,
      legal_entity_id: req.session!.legal_entity_id,
      period_id: '',
      posting_date: today,
      ncr_number: ncr.ncr_number,
      item_code: ncr.item_code,
      item_name: ncr.item_name,
      quantity: ncr.quantity,
      unit_cost: ncr.unit_cost && !new Money(ncr.unit_cost).isZero() ? ncr.unit_cost : '100.00000000',
      scrap_expense_account_id: scrapAcc,
      inventory_account_id: invAcc,
    });

    const journalId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      let totalDebit = Money.zero();
      let totalCredit = Money.zero();
      for (const l of scrapJournalDraft.lines) {
        totalDebit = totalDebit.add(new Money(l.base_debit));
        totalCredit = totalCredit.add(new Money(l.base_credit));
      }

      // Insert journal
      await tx.query(
        `INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, source_type, source_id, created_by, posted_by, posted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', 'PKR', $8, $9, $10, 'QUALITY_NCR', $11, $12, $12, CURRENT_TIMESTAMP)`,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          scrapJournalDraft.journal_number,
          today,
          today,
          scrapJournalDraft.accounting_purpose,
          totalDebit.format(),
          totalCredit.format(),
          scrapJournalDraft.description,
          id,
          req.session!.user_id,
        ]
      );

      // Insert journal lines
      for (const line of scrapJournalDraft.lines) {
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

      // Update NCR status
      await tx.query(
        `UPDATE quality_non_conformance_reports 
         SET status = 'CLOSED', disposition = 'SCRAP', scrap_journal_id = $1, updated_at = NOW() 
         WHERE id = $2`,
        [journalId, id]
      );
    });

    return res.json({
      success: true,
      data: { id, status: 'CLOSED', disposition: 'SCRAP', scrap_journal_id: journalId },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Certificate of Analysis (CoA)
  app.get('/api/quality/coa', authenticate, requirePermission(Permission.QUALITY_COA_MANAGE), async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT coa.*, ql.lot_number, i.name as item_name, i.code as item_code, p.name as customer_name 
       FROM quality_certificates_of_analysis coa 
       JOIN quality_inspection_lots ql ON ql.id = coa.lot_id 
       JOIN items i ON i.id = coa.item_id 
       LEFT JOIN parties p ON p.id = coa.customer_id 
       WHERE coa.organization_id = $1 
       ORDER BY coa.created_at DESC`,
      [req.session!.organization_id]
    );
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/quality/coa', authenticate, requirePermission(Permission.QUALITY_COA_MANAGE), async (req: Request, res: Response) => {
    const { lot_id, customer_id, issue_date, certified_by } = req.body;

    if (!lot_id) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'lot_id is required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const lotRes = await db.query(`SELECT item_id FROM quality_inspection_lots WHERE id = $1`, [lot_id]);
    if (lotRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.LOT_NOT_FOUND, message: 'Inspection lot not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    const coaNum = `COA-${Date.now().toString().slice(-6)}`;
    const dateStr = issue_date || new Date().toISOString().slice(0, 10);

    await db.query(
      `INSERT INTO quality_certificates_of_analysis (
        id, organization_id, coa_number, lot_id, item_id, customer_id, issue_date, certified_by, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ISSUED')`,
      [
        id,
        req.session!.organization_id,
        coaNum,
        lot_id,
        lotRes.rows[0].item_id,
        customer_id || null,
        dateStr,
        certified_by || req.session!.name || 'Lead Quality Officer',
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, coa_number: coaNum, status: 'ISSUED' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
}
