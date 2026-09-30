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
import { postJournal } from '../lib/posting.js';
import { transition } from '../lib/state.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { dateOnly, decimal, todayIso } from '../lib/validate.js';
import { lockItems, postStockMovement } from '../lib/stock.js';
import { accountByCode } from '../lib/trading.js';

export function registerMaintenanceRoutes(app: Express): void {
  // 24. Plant Maintenance & Equipment Engineering (M9)
  // ==========================================

  // Equipment Register
  app.get('/api/maintenance/equipment', authenticate, requirePermission(Permission.EQUIPMENT_MANAGE), async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT me.*, fa.name as fixed_asset_name 
       FROM maintenance_equipment me 
       LEFT JOIN fixed_assets fa ON fa.id = me.fixed_asset_id 
       WHERE me.organization_id = $1 
       ORDER BY me.equipment_code ASC`,
      [req.session!.organization_id]
    );
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/maintenance/equipment', authenticate, requirePermission(Permission.EQUIPMENT_MANAGE), async (req: Request, res: Response) => {
    const { equipment_code, name, fixed_asset_id, category, location, criticality, serial_number } = req.body;

    if (!equipment_code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'equipment_code and name are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();

    await db.query(
      `INSERT INTO maintenance_equipment (
        id, organization_id, legal_entity_id, equipment_code, name, fixed_asset_id, category, location, criticality, status, operating_hours, serial_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPERATIONAL', '0.00000000', $10)`,
      [
        id,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        equipment_code,
        name,
        fixed_asset_id || null,
        category || 'MACHINERY',
        location || null,
        criticality || 'MEDIUM',
        serial_number || null,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, equipment_code, name, status: 'OPERATIONAL' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Preventive Maintenance (PM) Schedules
  app.get('/api/maintenance/schedules', authenticate, requirePermission(Permission.PM_SCHEDULE_MANAGE), async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT ps.*, me.name as equipment_name, me.equipment_code 
       FROM pm_schedules ps 
       JOIN maintenance_equipment me ON me.id = ps.equipment_id 
       WHERE ps.organization_id = $1 
       ORDER BY ps.next_due_date ASC`,
      [req.session!.organization_id]
    );
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/maintenance/schedules', authenticate, requirePermission(Permission.PM_SCHEDULE_MANAGE), async (req: Request, res: Response) => {
    const { equipment_id, schedule_name, frequency_type, frequency_interval, next_due_date } = req.body;

    if (!equipment_id || !schedule_name || !frequency_interval) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'equipment_id, schedule_name, and frequency_interval are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    const dueDate = next_due_date || MaintenanceEngine.calculateNextDueDate(new Date().toISOString().slice(0, 10), parseInt(frequency_interval, 10));

    await db.query(
      `INSERT INTO pm_schedules (
        id, organization_id, equipment_id, schedule_name, frequency_type, frequency_interval, next_due_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')`,
      [
        id,
        req.session!.organization_id,
        equipment_id,
        schedule_name,
        frequency_type || 'TIME_BASED_DAYS',
        frequency_interval,
        dueDate,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, schedule_name, next_due_date: dueDate, status: 'ACTIVE' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Maintenance Work Orders
  app.get('/api/maintenance/work-orders', authenticate, requirePermission(Permission.MAINT_WORK_ORDER_MANAGE), async (req: Request, res: Response) => {
    const woRes = await db.query(
      `SELECT wo.*, me.name as equipment_name, me.equipment_code 
       FROM maintenance_work_orders wo 
       JOIN maintenance_equipment me ON me.id = wo.equipment_id 
       WHERE wo.organization_id = $1 
       ORDER BY wo.created_at DESC`,
      [req.session!.organization_id]
    );

    const partsRes = await db.query(
      `SELECT mop.*, i.name as item_name, i.code as item_code 
       FROM maint_order_parts mop 
       JOIN maintenance_work_orders wo ON wo.id = mop.work_order_id 
       JOIN items i ON i.id = mop.item_id 
       WHERE wo.organization_id = $1`,
      [req.session!.organization_id]
    );

    const laborRes = await db.query(
      `SELECT mol.* 
       FROM maint_order_labor mol 
       JOIN maintenance_work_orders wo ON wo.id = mol.work_order_id 
       WHERE wo.organization_id = $1`,
      [req.session!.organization_id]
    );

    const partsByWo = new Map<string, any[]>();
    for (const p of partsRes.rows) {
      if (!partsByWo.has(p.work_order_id)) partsByWo.set(p.work_order_id, []);
      partsByWo.get(p.work_order_id)!.push(p);
    }

    const laborByWo = new Map<string, any[]>();
    for (const l of laborRes.rows) {
      if (!laborByWo.has(l.work_order_id)) laborByWo.set(l.work_order_id, []);
      laborByWo.get(l.work_order_id)!.push(l);
    }

    const workOrders = woRes.rows.map((wo) => ({
      ...wo,
      parts: partsByWo.get(wo.id) || [],
      labor: laborByWo.get(wo.id) || [],
    }));

    return res.json({
      success: true,
      data: workOrders,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/maintenance/work-orders', authenticate, requirePermission(Permission.MAINT_WORK_ORDER_MANAGE), async (req: Request, res: Response) => {
    const { equipment_id, pm_schedule_id, order_type, priority, description, failure_code, start_date, parts, labor } = req.body;

    if (!equipment_id || !description) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'equipment_id and description are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const costing = MaintenanceEngine.calculateWorkOrderCost(parts || [], labor || []);
    const woId = crypto.randomUUID();
    const woNum = await nextDocumentNumber(db, req.session!.organization_id, 'WO');

    await db.transaction(async (tx) => {
      // 1. Insert Work Order
      await tx.query(
        `INSERT INTO maintenance_work_orders (
          id, organization_id, legal_entity_id, work_order_number, equipment_id, pm_schedule_id,
          order_type, priority, status, description, failure_code, start_date,
          total_parts_cost, total_labor_cost, total_cost, downtime_hours, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'IN_PROGRESS', $9, $10, $11, $12, $13, $14, '0.00000000', $15)`,
        [
          woId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          woNum,
          equipment_id,
          pm_schedule_id || null,
          order_type || 'PREVENTIVE',
          priority || 'MEDIUM',
          description,
          failure_code || null,
          start_date || new Date().toISOString().slice(0, 10),
          costing.total_parts_cost,
          costing.total_labor_cost,
          costing.total_cost,
          req.session!.user_id,
        ]
      );

      // 2. Insert Parts
      if (Array.isArray(parts)) {
        for (const p of parts) {
          const lineCost = new Money(p.quantity).mul(new Money(p.unit_cost)).toFixed(8);
          await tx.query(
            `INSERT INTO maint_order_parts (id, work_order_id, item_id, quantity, unit_cost, total_cost)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [crypto.randomUUID(), woId, p.item_id, p.quantity, p.unit_cost, lineCost]
          );
        }
      }

      // 3. Insert Labor
      if (Array.isArray(labor)) {
        for (const l of labor) {
          const lineCost = new Money(l.labor_hours).mul(new Money(l.hourly_rate)).toFixed(8);
          await tx.query(
            `INSERT INTO maint_order_labor (id, work_order_id, technician_name, labor_hours, hourly_rate, total_cost)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [crypto.randomUUID(), woId, l.technician_name, l.labor_hours, l.hourly_rate, lineCost]
          );
        }
      }

      // Set equipment status to UNDER_MAINTENANCE
      await tx.query(`UPDATE maintenance_equipment SET status = 'UNDER_MAINTENANCE' WHERE id = $1`, [equipment_id]);
    });

    return res.status(201).json({
      success: true,
      data: {
        id: woId,
        work_order_number: woNum,
        status: 'IN_PROGRESS',
        total_cost: costing.total_cost,
      },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Complete Maintenance Work Order & Post Balanced GL Settlement
  app.post('/api/maintenance/work-orders/:id/complete', authenticate, requirePermission(Permission.MAINT_WORK_ORDER_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;
    const { downtime_hours } = req.body;

    const woRes = await db.query(
      `SELECT wo.*, me.equipment_code, me.name as equipment_name 
       FROM maintenance_work_orders wo 
       JOIN maintenance_equipment me ON me.id = wo.equipment_id 
       WHERE wo.id = $1 AND wo.organization_id = $2`,
      [id, req.session!.organization_id]
    );

    if (woRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Work order not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const wo = woRes.rows[0];
    if (wo.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.WORK_ORDER_ALREADY_COMPLETED, message: 'Work order is already completed', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const completionDate = dateOnly(req.body?.completion_date, 'completion_date', { defaultValue: todayIso() });
    const downtime = decimal(downtime_hours == null ? undefined : String(downtime_hours), 'downtime_hours', { required: false, defaultValue: '0' });
    const journalId = await db.transaction(async (tx) => {
      // Atomic completion (double-complete previously re-posted the settlement).
      await transition(tx, { table: 'maintenance_work_orders', id, organizationId: req.session!.organization_id, from: ['DRAFT', 'SCHEDULED', 'IN_PROGRESS'], to: 'COMPLETED', label: 'Maintenance work order', set: { completion_date: completionDate, downtime_hours: downtime } });
      const org = req.session!.organization_id;
      // Spare parts leave stock and are credited to each part's own inventory account.
      const parts = (await tx.query(`SELECT * FROM maint_order_parts WHERE work_order_id = $1`, [id])).rows;
      const items = await lockItems(tx, org, parts.map((p: any) => p.item_id));
      const lines: any[] = [];
      let partsTotal = Money.zero();
      for (const p of parts) {
        const item = items.get(p.item_id);
        const cost = new Money(p.total_cost).round(2);
        partsTotal = partsTotal.add(cost);
        if (item.item_type === 'INVENTORY') {
          await postStockMovement(tx, { organizationId: org, legalEntityId: req.session!.legal_entity_id, itemId: p.item_id, warehouseId: null, movementType: 'ADJUSTMENT', movementDate: completionDate, quantity: new Money(p.quantity).negated().toFixed(8), unitCost: p.unit_cost, referenceType: 'MAINT_WORK_ORDER', referenceId: id, description: `Spare parts issued to ${wo.work_order_number}` });
        }
        lines.push({ account_id: item.inventory_account_id || (await accountByCode(tx, org, '113001')), credit: cost.toFixed(8), description: `Spare parts ${item.code}` });
      }
      // Internal labour is re-classified out of salaries expense (it was previously
      // credited to Salaries Payable, double-counting the payroll liability).
      const labor = new Money(wo.total_labor_cost || '0').round(2);
      if (labor.isPositive()) lines.push({ account_code: '521002', credit: labor.toFixed(8), description: `Labour absorbed by ${wo.work_order_number}` });
      const total = partsTotal.add(labor);
      let posted = null;
      if (total.isPositive()) {
        lines.unshift({ account_code: '521005', debit: total.toFixed(8), description: `Maintenance cost ${wo.equipment_code}` });
        posted = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org, legalEntityId: req.session!.legal_entity_id, userId: req.session!.user_id, postingDate: completionDate,
          purpose: AccountingPurpose.MAINTENANCE_EXPENSE_SETTLEMENT, description: `Maintenance settlement ${wo.work_order_number} — ${wo.equipment_name}`,
          sourceType: 'MAINT_WORK_ORDER', sourceId: id, sourceKey: `MAINT_SETTLEMENT:${id}`, numberPrefix: 'JV-MNT', correlationId: req.correlationId, lines,
        });
      }
      await tx.query(`UPDATE maintenance_work_orders SET settlement_journal_id = $1, updated_at = NOW() WHERE id = $2`, [posted?.journalId ?? null, id]);
      await tx.query(`UPDATE maintenance_equipment SET status = 'OPERATIONAL' WHERE id = $1`, [wo.equipment_id]);
      // Preventive maintenance: roll the schedule forward from the actual completion date.
      if (wo.pm_schedule_id) {
        const sch = (await tx.query(`SELECT * FROM pm_schedules WHERE id = $1 FOR UPDATE`, [wo.pm_schedule_id])).rows[0];
        if (sch && sch.frequency_type === 'TIME_BASED_DAYS') {
          const days = Math.max(1, Math.round(Number(sch.frequency_interval)));
          const next = new Date(Date.parse(`${completionDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
          await tx.query(`UPDATE pm_schedules SET last_performed_date = $1, next_due_date = $2 WHERE id = $3`, [completionDate, next, sch.id]);
        } else if (sch) {
          await tx.query(`UPDATE pm_schedules SET last_performed_date = $1 WHERE id = $2`, [completionDate, sch.id]);
        }
      }
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'MAINT_WORK_ORDER_COMPLETED', entity_type: 'MAINT_WORK_ORDER', entity_id: id, after_state: { total: total.format(), downtime }, correlation_id: req.correlationId }, tx);
      return posted?.journalId ?? null;
    });

    return res.json({
      success: true,
      data: { id, status: 'COMPLETED', settlement_journal_id: journalId, total_cost: wo.total_cost },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Equipment Calibrations
  app.get('/api/maintenance/calibrations', authenticate, requirePermission(Permission.CALIBRATION_MANAGE), async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT ec.*, me.name as equipment_name, me.equipment_code 
       FROM equipment_calibrations ec 
       JOIN maintenance_equipment me ON me.id = ec.equipment_id 
       WHERE ec.organization_id = $1 
       ORDER BY ec.calibration_date DESC`,
      [req.session!.organization_id]
    );
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/maintenance/calibrations', authenticate, requirePermission(Permission.CALIBRATION_MANAGE), async (req: Request, res: Response) => {
    const { equipment_id, calibration_certificate_no, calibration_date, expiry_date, calibration_agency, result, notes } = req.body;

    if (!equipment_id || !calibration_certificate_no) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'equipment_id and calibration_certificate_no are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();

    await db.query(
      `INSERT INTO equipment_calibrations (
        id, organization_id, equipment_id, calibration_certificate_no, calibration_date, expiry_date, calibration_agency, result, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        req.session!.organization_id,
        equipment_id,
        calibration_certificate_no,
        calibration_date || new Date().toISOString().slice(0, 10),
        expiry_date || new Date().toISOString().slice(0, 10),
        calibration_agency || 'Certified Testing Bureau',
        result || 'PASS',
        notes || null,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, calibration_certificate_no, result: result || 'PASS' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });
}
