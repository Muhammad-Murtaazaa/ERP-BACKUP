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
import { ApiError } from '../lib/errors.js';
import { postJournal } from '../lib/posting.js';
import { dateOnly, todayIso } from '../lib/validate.js';
import { lockItems, onHand, postStockMovement } from '../lib/stock.js';
import { accountByCode } from '../lib/trading.js';

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

    const scrapDate = dateOnly(req.body?.scrap_date, 'scrap_date', { defaultValue: todayIso() });
    const journalId = await db.transaction(async (tx) => {
      // Atomic state change: a second concurrent scrap of the same NCR is rejected.
      const locked = (await tx.query(`SELECT * FROM quality_non_conformance_reports WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, req.session!.organization_id])).rows[0];
      if (locked.status === 'CLOSED') throw new ApiError(409, ErrorCode.NCR_ALREADY_CLOSED, 'NCR is already closed');
      const item = (await lockItems(tx, req.session!.organization_id, [ncr.item_id])).get(ncr.item_id);
      // Previously a fabricated 100.00 unit cost was used when the item had none, and the
      // credit always hit Raw Materials regardless of the item's inventory account.
      const unitCost = new Money(item.unit_cost || '0');
      const invAcc = item.inventory_account_id || (await accountByCode(tx, req.session!.organization_id, '113001'));
      const scrapAcc = await accountByCode(tx, req.session!.organization_id, '511003');
      // QM lots are not yet linked to a goods receipt, so stock is only reduced when the
      // quantity is actually on hand; otherwise the write-off is flagged as a
      // stock/GL reconciliation exception (surfaced by the automation reconciliation job).
      let stockAdjusted = false;
      if (item.item_type === 'INVENTORY' && !new Money(await onHand(tx, req.session!.organization_id, ncr.item_id, null)).lt(ncr.quantity)) {
        stockAdjusted = true;
        await postStockMovement(tx, {
          organizationId: req.session!.organization_id,
          legalEntityId: req.session!.legal_entity_id,
          itemId: ncr.item_id,
          warehouseId: null,
          movementType: 'ADJUSTMENT',
          movementDate: scrapDate,
          quantity: new Money(ncr.quantity).negated().toFixed(8),
          unitCost: unitCost.toFixed(8),
          referenceType: 'QUALITY_NCR',
          referenceId: id,
          description: `Scrap write-off ${ncr.ncr_number}`,
        });
      }
      const value = unitCost.mul(ncr.quantity).round(2);
      const posted = value.isPositive()
        ? await postJournal(tx, auditLogger, outboxService, {
            organizationId: req.session!.organization_id,
            legalEntityId: req.session!.legal_entity_id,
            userId: req.session!.user_id,
            postingDate: scrapDate,
            purpose: AccountingPurpose.QUALITY_SCRAP_WRITEOFF,
            description: `Quality scrap write-off ${ncr.ncr_number} (${ncr.item_code})`,
            sourceType: 'QUALITY_NCR',
            sourceId: id,
            sourceKey: `NCR_SCRAP:${id}`,
            numberPrefix: 'JV-QSC',
            correlationId: req.correlationId,
            lines: [
              { account_id: scrapAcc, debit: value.toFixed(8), description: `Scrap expense ${ncr.ncr_number}` },
              { account_id: invAcc, credit: value.toFixed(8), description: `Inventory write-off ${ncr.item_code}` },
            ],
          })
        : null;
      await tx.query(
        `UPDATE quality_non_conformance_reports SET status = 'CLOSED', disposition = 'SCRAP', scrap_journal_id = $1, updated_at = NOW() WHERE id = $2`,
        [posted?.journalId ?? null, id],
      );
      await auditLogger.record({ organization_id: req.session!.organization_id, user_id: req.session!.user_id, action: 'NCR_SCRAPPED', entity_type: 'QUALITY_NCR', entity_id: id, after_state: { quantity: ncr.quantity, value: value.format(), stock_adjusted: stockAdjusted, reconciliation_exception: !stockAdjusted && item.item_type === 'INVENTORY' }, correlation_id: req.correlationId }, tx);
      return posted?.journalId ?? null;
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
