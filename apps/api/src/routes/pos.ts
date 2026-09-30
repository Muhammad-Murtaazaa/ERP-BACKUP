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

export function registerPosRoutes(app: Express): void {
  // 22. Point of Sale (POS) Module
  // ==========================================

  // POS Registers
  app.get('/api/pos/registers', authenticate, requirePermission(Permission.POS_TERMINAL), async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT pr.*, w.name as warehouse_name 
       FROM pos_registers pr 
       LEFT JOIN warehouses w ON w.id = pr.warehouse_id 
       WHERE pr.organization_id = $1 
       ORDER BY pr.register_code ASC`,
      [req.session!.organization_id]
    );
    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/pos/registers', authenticate, requirePermission(Permission.POS_REGISTER_MANAGE), async (req: Request, res: Response) => {
    const { register_code, name, warehouse_id, cash_account_id, card_clearing_account_id } = req.body;

    if (!register_code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Register code and name are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO pos_registers (id, register_code, name, warehouse_id, cash_account_id, card_clearing_account_id, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        register_code,
        name,
        warehouse_id || null,
        cash_account_id || null,
        card_clearing_account_id || null,
        req.session!.organization_id,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, register_code, name },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // POS Sessions (Cashier Shifts)
  app.get('/api/pos/sessions/active', authenticate, requirePermission(Permission.POS_TERMINAL), async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT ps.*, pr.register_code, pr.name as register_name 
       FROM pos_sessions ps 
       JOIN pos_registers pr ON pr.id = ps.register_id 
       WHERE ps.organization_id = $1 AND ps.status = 'OPEN' 
       ORDER BY ps.opened_at DESC LIMIT 1`,
      [req.session!.organization_id]
    );

    return res.json({
      success: true,
      data: result.rows[0] || null,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/pos/sessions/open', authenticate, requirePermission(Permission.POS_TERMINAL), async (req: Request, res: Response) => {
    const { register_id, opening_float } = req.body;

    if (!register_id) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'register_id is required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    // Check if register already has open session
    const openRes = await db.query(
      `SELECT id FROM pos_sessions WHERE register_id = $1 AND status = 'OPEN'`,
      [register_id]
    );
    if (openRes.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.POS_SESSION_ALREADY_OPEN, message: 'Register already has an active open session', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    const floatStr = new Money(opening_float || '0').toFixed(8);

    await db.query(
      `INSERT INTO pos_sessions (
        id, register_id, cashier_id, cashier_name, opened_at, opening_float,
        cash_sales_total, card_sales_total, expected_cash_drawer, cash_difference, status, organization_id
      ) VALUES ($1, $2, $3, $4, NOW(), $5, '0.00000000', '0.00000000', $5, '0.00000000', 'OPEN', $6)`,
      [
        id,
        register_id,
        req.session!.user_id,
        req.session!.name || req.session!.email,
        floatStr,
        req.session!.organization_id,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, register_id, opening_float: floatStr, status: 'OPEN' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Process POS Order
  app.post('/api/pos/orders', authenticate, requirePermission(Permission.POS_TERMINAL), async (req: Request, res: Response) => {
    const {
      session_id,
      order_number,
      customer_id,
      items,
      discount_amount,
      tax_percentage,
      payment_method,
      cash_tendered,
    } = req.body;

    if (!session_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'session_id and items are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    // Verify session is OPEN
    const sessionRes = await db.query(
      `SELECT ps.*, pr.warehouse_id 
       FROM pos_sessions ps 
       JOIN pos_registers pr ON pr.id = ps.register_id 
       WHERE ps.id = $1 AND ps.organization_id = $2`,
      [session_id, req.session!.organization_id]
    );
    if (sessionRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'POS session not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const session = sessionRes.rows[0];
    if (session.status !== 'OPEN') {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.POS_SESSION_CLOSED, message: 'Session is already closed', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const calculated = POSEngine.calculateOrder(
      items,
      discount_amount || '0.00',
      tax_percentage || '0.00',
      cash_tendered || '0.00'
    );

    const method = payment_method || 'CASH';
    if (method === 'CASH' && new Money(cash_tendered || '0').lt(new Money(calculated.total_amount))) {
      return res.status(422).json({
        success: false,
        error: { code: ErrorCode.INSUFFICIENT_PAYMENT_TENDER, message: 'Cash tendered is less than order total', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const orderId = crypto.randomUUID();
    const orderNum = order_number || `POS-${Date.now().toString().slice(-6)}`;

    await db.transaction(async (tx) => {
      // 1. Insert order
      await tx.query(
        `INSERT INTO pos_orders (
          id, session_id, order_number, customer_id, subtotal, discount_amount,
          tax_amount, total_amount, payment_method, cash_tendered, change_due, status, organization_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'COMPLETED', $12)`,
        [
          orderId,
          session_id,
          orderNum,
          customer_id || null,
          calculated.subtotal,
          calculated.discount_amount,
          calculated.tax_amount,
          calculated.total_amount,
          method,
          calculated.cash_tendered,
          calculated.change_due,
          req.session!.organization_id,
        ]
      );

      // 2. Insert order lines & record inventory stock movements
      for (const l of calculated.lines) {
        await tx.query(
          `INSERT INTO pos_order_lines (
            id, order_id, item_id, item_code, item_name, quantity, unit_price, line_total, tax_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            orderId,
            l.item_id,
            l.item_code,
            l.item_name,
            l.quantity,
            l.unit_price,
            l.line_total,
            l.tax_amount,
          ]
        );

        // Decrement stock from register warehouse if set
        if (session.warehouse_id) {
          await tx.query(
            `INSERT INTO stock_movements (
              id, organization_id, legal_entity_id, item_id, warehouse_id, movement_type,
              movement_date, quantity, unit_cost, total_value, reference_type, reference_id, description
            ) VALUES ($1, $2, $3, $4, $5, 'SHIPMENT', CURRENT_DATE, $6, $7, $8, 'POS_ORDER', $9, 'POS Sale Decrement')`,
            [
              crypto.randomUUID(),
              req.session!.organization_id,
              req.session!.legal_entity_id,
              l.item_id,
              session.warehouse_id,
              -parseFloat(l.quantity),
              l.unit_price,
              -parseFloat(l.line_total),
              orderId,
            ]
          );
        }
      }

      // 3. Update session sales totals
      if (method === 'CASH') {
        await tx.query(
          `UPDATE pos_sessions 
           SET cash_sales_total = cash_sales_total + $1, expected_cash_drawer = expected_cash_drawer + $1 
           WHERE id = $2`,
          [calculated.total_amount, session_id]
        );
      } else {
        await tx.query(
          `UPDATE pos_sessions 
           SET card_sales_total = card_sales_total + $1 
           WHERE id = $2`,
          [calculated.total_amount, session_id]
        );
      }
    });

    return res.status(201).json({
      success: true,
      data: {
        id: orderId,
        order_number: orderNum,
        subtotal: calculated.subtotal,
        discount_amount: calculated.discount_amount,
        tax_amount: calculated.tax_amount,
        total_amount: calculated.total_amount,
        change_due: calculated.change_due,
        status: 'COMPLETED',
      },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Close POS Session & Post Settlement Journal
  app.post('/api/pos/sessions/:id/close', authenticate, requirePermission(Permission.POS_SESSION_CLOSE), async (req: Request, res: Response) => {
    const { id } = req.params;
    const { actual_cash_drawer } = req.body;

    const sessionRes = await db.query(
      `SELECT ps.*, pr.register_code, pr.cash_account_id, pr.card_clearing_account_id 
       FROM pos_sessions ps 
       JOIN pos_registers pr ON pr.id = ps.register_id 
       WHERE ps.id = $1 AND ps.organization_id = $2`,
      [id, req.session!.organization_id]
    );
    if (sessionRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'POS session not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const session = sessionRes.rows[0];
    if (session.status !== 'OPEN') {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.POS_SESSION_CLOSED, message: 'Session is already closed', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const reconciled = POSEngine.reconcileSession(
      session.opening_float,
      session.cash_sales_total,
      session.card_sales_total,
      actual_cash_drawer !== undefined ? actual_cash_drawer.toString() : session.expected_cash_drawer
    );

    // Look up COA accounts
    const accRes = await db.query(
      `SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('111001', '111002', '411001', '212001', '511002')`,
      [req.session!.organization_id]
    );
    const map = new Map<string, string>(accRes.rows.map((r) => [r.code, r.id]));

    const cashAcc = session.cash_account_id || map.get('111001');
    const cardAcc = session.card_clearing_account_id || map.get('111002');
    const salesAcc = map.get('411001');
    const taxAcc = map.get('212001');
    const varAcc = map.get('511002');

    if (!cashAcc || !cardAcc || !salesAcc || !taxAcc || !varAcc) {
      return res.status(422).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Required accounts not configured for POS settlement', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const today = new Date().toISOString().slice(0, 10);
    const journalDraft = POSEngine.generateSessionClosingJournal({
      organization_id: req.session!.organization_id,
      legal_entity_id: req.session!.legal_entity_id,
      period_id: '',
      posting_date: today,
      session_id: id,
      register_code: session.register_code,
      cash_sales: session.cash_sales_total,
      card_sales: session.card_sales_total,
      tax_amount: '0.00000000',
      cash_difference: reconciled.cash_difference,
      cash_account_id: cashAcc,
      card_clearing_account_id: cardAcc,
      sales_account_id: salesAcc,
      tax_payable_account_id: taxAcc,
      cash_variance_expense_account_id: varAcc,
    });

    const journalId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      let totalDebit = Money.zero();
      let totalCredit = Money.zero();
      for (const l of journalDraft.lines) {
        totalDebit = totalDebit.add(new Money(l.base_debit));
        totalCredit = totalCredit.add(new Money(l.base_credit));
      }

      if (!totalDebit.isZero()) {
        // Insert journal
        await tx.query(
          `INSERT INTO journals (
            id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
            accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
            description, source_type, source_id, created_by, posted_by, posted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', 'PKR', $8, $9, $10, 'POS_SESSION', $11, $12, $12, CURRENT_TIMESTAMP)`,
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
      }

      // Update POS session
      await tx.query(
        `UPDATE pos_sessions 
         SET status = 'CLOSED', closed_at = NOW(), actual_cash_drawer = $1, cash_difference = $2, closing_journal_id = $3 
         WHERE id = $4`,
        [reconciled.actual_cash_drawer, reconciled.cash_difference, totalDebit.isZero() ? null : journalId, id]
      );
    });

    return res.json({
      success: true,
      data: {
        id,
        status: 'CLOSED',
        expected_cash_drawer: reconciled.expected_cash_drawer,
        actual_cash_drawer: reconciled.actual_cash_drawer,
        cash_difference: reconciled.cash_difference,
        closing_journal_id: journalId,
      },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
}
