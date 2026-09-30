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

export function registerSalesRoutes(app: Express): void {
  // 10. M2: Sales Orders & Fulfillments
  // ==========================================
  app.get('/api/sales/orders', authenticate, async (req: Request, res: Response) => {
    const ordersRes = await db.query(
      `
      SELECT so.*, p.name as party_name, p.code as party_code
      FROM sales_orders so
      JOIN parties p ON p.id = so.party_id
      WHERE so.organization_id = $1
      ORDER BY so.order_date DESC, so.created_at DESC
    `,
      [req.session!.organization_id],
    );

    return res.json({
      success: true,
      data: ordersRes.rows,
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        total_count: ordersRes.rows.length,
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.get('/api/sales/orders/:id', authenticate, async (req: Request, res: Response) => {
    const { id } = req.params;
    const orderRes = await db.query(
      `
      SELECT so.*, p.name as party_name, p.code as party_code
      FROM sales_orders so
      JOIN parties p ON p.id = so.party_id
      WHERE so.id = $1 AND so.organization_id = $2
    `,
      [id, req.session!.organization_id],
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'Sales order not found',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const linesRes = await db.query(
      `
      SELECT sol.*, i.code as item_code, i.name as item_name, i.uom
      FROM sales_order_lines sol
      JOIN items i ON i.id = sol.item_id
      WHERE sol.sales_order_id = $1
      ORDER BY sol.line_number ASC
    `,
      [id],
    );

    return res.json({
      success: true,
      data: {
        ...orderRes.rows[0],
        lines: linesRes.rows,
      },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/sales/orders', authenticate, requirePermission(Permission.SALES_ORDER_MANAGE), async (req: Request, res: Response) => {
    const { party_id, order_date, delivery_date, lines, notes } = req.body;

    if (!party_id || !lines || lines.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'party_id and at least 1 line are required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    let subtotal = Money.zero();
    for (const l of lines) {
      const qty = new Money(l.quantity || '0');
      const price = new Money(l.unit_price || '0');
      subtotal = subtotal.add(qty.mul(price));
    }

    const orderId = crypto.randomUUID();
    const orderNumber = `SO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    await db.transaction(async (tx) => {
      await tx.query(
        `
        INSERT INTO sales_orders (
          id, organization_id, legal_entity_id, party_id, order_number, order_date,
          delivery_date, status, subtotal, tax_amount, total_amount, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, 0, $8, $9, $10)
      `,
        [
          orderId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          party_id,
          orderNumber,
          order_date || new Date().toISOString().slice(0, 10),
          delivery_date || null,
          subtotal.toFixed(8),
          notes || null,
          req.session!.user_id,
        ],
      );

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const lineId = crypto.randomUUID();
        const lineTotal = new Money(l.quantity).mul(new Money(l.unit_price)).toFixed(8);

        await tx.query(
          `
          INSERT INTO sales_order_lines (
            id, sales_order_id, line_number, item_id, quantity, unit_price, line_total, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
          [lineId, orderId, i + 1, l.item_id, l.quantity, l.unit_price, lineTotal, l.description || null],
        );
      }
    });

    return res.status(201).json({
      success: true,
      data: { id: orderId, order_number: orderNumber, status: 'DRAFT', subtotal: subtotal.toFixed(2) },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/sales/orders/:id/confirm', authenticate, requirePermission(Permission.SALES_ORDER_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;
    await db.query("UPDATE sales_orders SET status = 'CONFIRMED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);

    return res.json({
      success: true,
      data: { id, status: 'CONFIRMED' },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/sales/orders/:id/fulfill', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;

    const orderRes = await db.query('SELECT * FROM sales_orders WHERE id = $1 AND organization_id = $2', [
      id,
      req.session!.organization_id,
    ]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'Sales order not found',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const order = orderRes.rows[0];
    const linesRes = await db.query(
      'SELECT sol.*, i.item_type, i.unit_cost, i.cogs_account_id, i.inventory_account_id FROM sales_order_lines sol JOIN items i ON i.id = sol.item_id WHERE sol.sales_order_id = $1',
      [id],
    );

    let totalCogs = Money.zero();
    const branchRow = await db.query('SELECT id FROM branches WHERE organization_id = $1 LIMIT 1', [req.session!.organization_id]);
    const branchId = branchRow.rows[0]?.id;

    await db.transaction(async (tx) => {
      for (const line of linesRes.rows) {
        if (line.item_type === 'INVENTORY') {
          const qty = parseFloat(line.quantity);
          const cost = new Money(line.unit_cost || '0');
          const lineVal = cost.mul(qty);
          totalCogs = totalCogs.add(lineVal);

          // Record stock movement (SHIPMENT negative qty)
          const smId = crypto.randomUUID();
          await tx.query(
            `
            INSERT INTO stock_movements (
              id, organization_id, legal_entity_id, item_id, warehouse_id,
              movement_type, movement_date, quantity, unit_cost, total_value, reference_type, reference_id, description
            ) VALUES ($1, $2, $3, $4, $5, 'SHIPMENT', CURRENT_DATE, $6, $7, $8, 'SALES_ORDER', $9, 'Sales Order Shipment')
          `,
            [smId, req.session!.organization_id, req.session!.legal_entity_id, line.item_id, branchId, -qty, cost.toFixed(8), -parseFloat(lineVal.toFixed(8)), id],
          );

          await tx.query(
            'UPDATE sales_order_lines SET fulfilled_quantity = quantity WHERE id = $1',
            [line.id],
          );
        }
      }

      await tx.query("UPDATE sales_orders SET status = 'FULFILLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);

      // If inventory COGS applies, post GL journal voucher
      if (totalCogs.isPositive()) {
        const cogsAccRes = await tx.query("SELECT id FROM accounts WHERE code = '511001' AND organization_id = $1", [req.session!.organization_id]);
        const invAccRes = await tx.query("SELECT id FROM accounts WHERE code = '113001' AND organization_id = $1", [req.session!.organization_id]);

        if (cogsAccRes.rows[0] && invAccRes.rows[0]) {
          const jId = crypto.randomUUID();
          const jNum = `JV-COGS-${Date.now().toString().slice(-6)}`;
          await tx.query(
            `
            INSERT INTO journals (
              id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
              accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
              description, source_type, source_id, created_by, posted_by, posted_at
            ) VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE, 'INVENTORY_ISSUE', 'POSTED', 'PKR', $5, $5, $6, 'SALES_ORDER', $7, $8, $8, CURRENT_TIMESTAMP)
          `,
            [jId, req.session!.organization_id, req.session!.legal_entity_id, jNum, totalCogs.toFixed(8), `COGS for order ${order.order_number}`, id, req.session!.user_id],
          );

          // Lines: Dr COGS, Cr Inventory
          await tx.query(
            `
            INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description)
            VALUES 
              ($1, $2, 1, $3, $4, 0, $4, 0, 'Cost of goods sold'),
              ($5, $2, 2, $6, 0, $4, 0, $4, 'Inventory decrease')
          `,
            [crypto.randomUUID(), jId, cogsAccRes.rows[0].id, totalCogs.toFixed(8), crypto.randomUUID(), invAccRes.rows[0].id],
          );
        }
      }
    });

    return res.json({
      success: true,
      data: { id, status: 'FULFILLED' },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
  // 11. M2: Customer Invoicing (AR Billing)
  // ==========================================
  app.get('/api/ar/invoices', authenticate, async (req: Request, res: Response) => {
    const invRes = await db.query(
      `
      SELECT inv.*, p.name as party_name, p.code as party_code
      FROM ar_invoices inv
      JOIN parties p ON p.id = inv.party_id
      WHERE inv.organization_id = $1
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
    `,
      [req.session!.organization_id],
    );

    return res.json({
      success: true,
      data: invRes.rows,
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        total_count: invRes.rows.length,
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.get('/api/ar/invoices/:id', authenticate, async (req: Request, res: Response) => {
    const { id } = req.params;
    const invRes = await db.query(
      `
      SELECT inv.*, p.name as party_name, p.code as party_code
      FROM ar_invoices inv
      JOIN parties p ON p.id = inv.party_id
      WHERE inv.id = $1 AND inv.organization_id = $2
    `,
      [id, req.session!.organization_id],
    );

    if (invRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'AR Invoice not found',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const linesRes = await db.query(
      `
      SELECT il.*, i.code as item_code, i.name as item_name
      FROM ar_invoice_lines il
      JOIN items i ON i.id = il.item_id
      WHERE il.invoice_id = $1
      ORDER BY il.line_number ASC
    `,
      [id],
    );

    return res.json({
      success: true,
      data: {
        ...invRes.rows[0],
        lines: linesRes.rows,
      },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/ar/invoices', authenticate, requirePermission(Permission.AR_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const { party_id, sales_order_id, invoice_date, due_date, lines, notes } = req.body;

    if (!party_id || !lines || lines.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'party_id and at least 1 line are required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    let subtotal = Money.zero();
    for (const l of lines) {
      const qty = new Money(l.quantity || '0');
      const price = new Money(l.unit_price || '0');
      subtotal = subtotal.add(qty.mul(price));
    }

    const invoiceId = crypto.randomUUID();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    await db.transaction(async (tx) => {
      await tx.query(
        `
        INSERT INTO ar_invoices (
          id, organization_id, legal_entity_id, party_id, sales_order_id, invoice_number,
          invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount,
          notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, 0, $9, $9, $10, $11)
      `,
        [
          invoiceId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          party_id,
          sales_order_id || null,
          invoiceNumber,
          invoice_date || new Date().toISOString().slice(0, 10),
          due_date || new Date().toISOString().slice(0, 10),
          subtotal.toFixed(8),
          notes || null,
          req.session!.user_id,
        ],
      );

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const lineId = crypto.randomUUID();
        const lineTotal = new Money(l.quantity).mul(new Money(l.unit_price)).toFixed(8);

        await tx.query(
          `
          INSERT INTO ar_invoice_lines (
            id, invoice_id, line_number, item_id, quantity, unit_price, line_total, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
          [lineId, invoiceId, i + 1, l.item_id, l.quantity, l.unit_price, lineTotal, l.description || null],
        );
      }
    });

    return res.status(201).json({
      success: true,
      data: { id: invoiceId, invoice_number: invoiceNumber, status: 'DRAFT', total_amount: subtotal.toFixed(2) },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/ar/invoices/:id/post', authenticate, requirePermission(Permission.AR_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;

    const invRes = await db.query(
      'SELECT inv.*, p.name as party_name FROM ar_invoices inv JOIN parties p ON p.id = inv.party_id WHERE inv.id = $1 AND inv.organization_id = $2',
      [id, req.session!.organization_id],
    );

    if (invRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'AR invoice not found',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const invoice = invRes.rows[0];
    if (invoice.status === 'POSTED') {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.ALREADY_POSTED,
          message: 'Invoice is already posted',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    // Look up Trade AR Control (112001) and Product Sales (411001)
    const arAccRes = await db.query("SELECT id FROM accounts WHERE code = '112001' AND organization_id = $1", [req.session!.organization_id]);
    const salesAccRes = await db.query("SELECT id FROM accounts WHERE code = '411001' AND organization_id = $1", [req.session!.organization_id]);

    if (!arAccRes.rows[0] || !salesAccRes.rows[0]) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Missing standard AR Control (112001) or Sales (411001) account in COA',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const arAccId = arAccRes.rows[0].id;
    const salesAccId = salesAccRes.rows[0].id;
    const total = new Money(invoice.total_amount);

    const journalId = crypto.randomUUID();
    const journalNumber = `JV-AR-${invoice.invoice_number}`;

    await db.transaction(async (tx) => {
      // 1. Post GL Journal
      await tx.query(
        `
        INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, source_type, source_id, created_by, posted_by, posted_at
        ) VALUES ($1, $2, $3, $4, $5, $5, 'SALES_INVOICE', 'POSTED', 'PKR', $6, $6, $7, 'AR_INVOICE', $8, $9, $9, CURRENT_TIMESTAMP)
      `,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          journalNumber,
          invoice.invoice_date,
          total.toFixed(8),
          `Invoice ${invoice.invoice_number} to ${invoice.party_name}`,
          id,
          req.session!.user_id,
        ],
      );

      // 2. Insert Lines (Dr AR Control, Cr Sales Revenue)
      await tx.query(
        `
        INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description, party_id)
        VALUES
          ($1, $2, 1, $3, $4, 0, $4, 0, $5, $6),
          ($7, $2, 2, $8, 0, $4, 0, $4, $5, $6)
      `,
        [
          crypto.randomUUID(),
          journalId,
          arAccId,
          total.toFixed(8),
          `Receivable from ${invoice.party_name}`,
          invoice.party_id,
          crypto.randomUUID(),
          salesAccId,
        ],
      );

      // 3. Mark AR Invoice as POSTED
      await tx.query(
        "UPDATE ar_invoices SET status = 'POSTED', posted_journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [journalId, id],
      );
    });

    return res.json({
      success: true,
      data: { id, status: 'POSTED', posted_journal_id: journalId },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
}
