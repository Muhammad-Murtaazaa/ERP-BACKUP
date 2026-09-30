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

export function registerProcurementRoutes(app: Express): void {
  // 12. M2: Purchase Orders & AP Invoices (Procure-to-Pay)
  // ==========================================
  app.get('/api/procurement/orders', authenticate, async (req: Request, res: Response) => {
    const ordersRes = await db.query(
      `
      SELECT po.*, p.name as party_name, p.code as party_code
      FROM purchase_orders po
      JOIN parties p ON p.id = po.party_id
      WHERE po.organization_id = $1
      ORDER BY po.po_date DESC, po.created_at DESC
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

  app.post('/api/procurement/orders', authenticate, requirePermission(Permission.PURCHASE_ORDER_MANAGE), async (req: Request, res: Response) => {
    const { party_id, po_date, expected_date, lines, notes } = req.body;

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

    const poId = crypto.randomUUID();
    const poNumber = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    await db.transaction(async (tx) => {
      await tx.query(
        `
        INSERT INTO purchase_orders (
          id, organization_id, legal_entity_id, party_id, po_number, po_date,
          expected_date, status, subtotal, tax_amount, total_amount, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, 0, $8, $9, $10)
      `,
        [
          poId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          party_id,
          poNumber,
          po_date || new Date().toISOString().slice(0, 10),
          expected_date || null,
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
          INSERT INTO purchase_order_lines (
            id, purchase_order_id, line_number, item_id, quantity, unit_price, line_total, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
          [lineId, poId, i + 1, l.item_id, l.quantity, l.unit_price, lineTotal, l.description || null],
        );
      }
    });

    return res.status(201).json({
      success: true,
      data: { id: poId, po_number: poNumber, status: 'DRAFT', subtotal: subtotal.toFixed(2) },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/procurement/orders/:id/approve', authenticate, requirePermission(Permission.PURCHASE_ORDER_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;
    await db.query("UPDATE purchase_orders SET status = 'APPROVED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);

    return res.json({
      success: true,
      data: { id, status: 'APPROVED' },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/procurement/orders/:id/receive', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;

    const poRes = await db.query('SELECT * FROM purchase_orders WHERE id = $1 AND organization_id = $2', [
      id,
      req.session!.organization_id,
    ]);
    if (poRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'Purchase order not found',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const po = poRes.rows[0];
    const linesRes = await db.query(
      'SELECT pol.*, i.item_type, i.unit_cost FROM purchase_order_lines pol JOIN items i ON i.id = pol.item_id WHERE pol.purchase_order_id = $1',
      [id],
    );

    const branchRow = await db.query('SELECT id FROM branches WHERE organization_id = $1 LIMIT 1', [req.session!.organization_id]);
    const branchId = branchRow.rows[0]?.id;

    let totalReceivedVal = Money.zero();

    await db.transaction(async (tx) => {
      for (const line of linesRes.rows) {
        if (line.item_type === 'INVENTORY') {
          const qty = parseFloat(line.quantity);
          const cost = new Money(line.unit_price || line.unit_cost || '0');
          const lineVal = cost.mul(qty);
          totalReceivedVal = totalReceivedVal.add(lineVal);

          const smId = crypto.randomUUID();
          await tx.query(
            `
            INSERT INTO stock_movements (
              id, organization_id, legal_entity_id, item_id, warehouse_id,
              movement_type, movement_date, quantity, unit_cost, total_value, reference_type, reference_id, description
            ) VALUES ($1, $2, $3, $4, $5, 'RECEIPT', CURRENT_DATE, $6, $7, $8, 'PURCHASE_ORDER', $9, 'Goods Receipt from PO')
          `,
            [smId, req.session!.organization_id, req.session!.legal_entity_id, line.item_id, branchId, qty, cost.toFixed(8), lineVal.toFixed(8), id],
          );

          await tx.query('UPDATE purchase_order_lines SET received_quantity = quantity WHERE id = $1', [line.id]);
        }
      }

      await tx.query("UPDATE purchase_orders SET status = 'RECEIVED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);

      // Post Inventory / GRNI Journal (Dr Inventory 113001, Cr GRNI 211002)
      if (totalReceivedVal.isPositive()) {
        const invAccRes = await tx.query("SELECT id FROM accounts WHERE code = '113001' AND organization_id = $1", [req.session!.organization_id]);
        const grniAccRes = await tx.query("SELECT id FROM accounts WHERE code = '211002' AND organization_id = $1", [req.session!.organization_id]);

        if (invAccRes.rows[0] && grniAccRes.rows[0]) {
          const jId = crypto.randomUUID();
          const jNum = `JV-GRNI-${Date.now().toString().slice(-6)}`;
          await tx.query(
            `
            INSERT INTO journals (
              id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
              accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
              description, source_type, source_id, created_by, posted_by, posted_at
            ) VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE, 'PURCHASE_RECEIPT', 'POSTED', 'PKR', $5, $5, $6, 'PURCHASE_ORDER', $7, $8, $8, CURRENT_TIMESTAMP)
          `,
            [jId, req.session!.organization_id, req.session!.legal_entity_id, jNum, totalReceivedVal.toFixed(8), `Goods receipt for PO ${po.po_number}`, id, req.session!.user_id],
          );

          await tx.query(
            `
            INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description)
            VALUES 
              ($1, $2, 1, $3, $4, 0, $4, 0, 'Inventory received'),
              ($5, $2, 2, $6, 0, $4, 0, $4, 'GRNI liability')
          `,
            [crypto.randomUUID(), jId, invAccRes.rows[0].id, totalReceivedVal.toFixed(8), crypto.randomUUID(), grniAccRes.rows[0].id],
          );
        }
      }
    });

    return res.json({
      success: true,
      data: { id, status: 'RECEIVED' },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.get('/api/ap/invoices', authenticate, async (req: Request, res: Response) => {
    const invRes = await db.query(
      `
      SELECT inv.*, p.name as party_name, p.code as party_code
      FROM ap_invoices inv
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

  app.post('/api/ap/invoices', authenticate, requirePermission(Permission.AP_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const { party_id, purchase_order_id, invoice_number, invoice_date, due_date, lines, notes } = req.body;

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
    const invNum = invoice_number || `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    await db.transaction(async (tx) => {
      await tx.query(
        `
        INSERT INTO ap_invoices (
          id, organization_id, legal_entity_id, party_id, purchase_order_id, invoice_number,
          invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount,
          notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, 0, $9, $9, $10, $11)
      `,
        [
          invoiceId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          party_id,
          purchase_order_id || null,
          invNum,
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
          INSERT INTO ap_invoice_lines (
            id, invoice_id, line_number, item_id, quantity, unit_price, line_total, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
          [lineId, invoiceId, i + 1, l.item_id, l.quantity, l.unit_price, lineTotal, l.description || null],
        );
      }
    });

    return res.status(201).json({
      success: true,
      data: { id: invoiceId, invoice_number: invNum, status: 'DRAFT', total_amount: subtotal.toFixed(2) },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/ap/invoices/:id/post', authenticate, requirePermission(Permission.AP_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;

    const invRes = await db.query(
      'SELECT inv.*, p.name as party_name FROM ap_invoices inv JOIN parties p ON p.id = inv.party_id WHERE inv.id = $1 AND inv.organization_id = $2',
      [id, req.session!.organization_id],
    );

    if (invRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'AP bill not found',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const bill = invRes.rows[0];
    if (bill.status === 'POSTED') {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.ALREADY_POSTED,
          message: 'Bill is already posted',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    // Look up GRNI (211002) or Inventory (113001) and Trade AP Control (211001)
    const apAccRes = await db.query("SELECT id FROM accounts WHERE code = '211001' AND organization_id = $1", [req.session!.organization_id]);
    const grniAccRes = await db.query("SELECT id FROM accounts WHERE code = '211002' AND organization_id = $1", [req.session!.organization_id]);

    const apAccId = apAccRes.rows[0].id;
    const grniAccId = grniAccRes.rows[0]?.id;
    const total = new Money(bill.total_amount);

    const journalId = crypto.randomUUID();
    const journalNumber = `JV-AP-${bill.invoice_number}`;

    await db.transaction(async (tx) => {
      // 1. Post GL Journal (Dr GRNI/Inventory, Cr AP Control)
      await tx.query(
        `
        INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, source_type, source_id, created_by, posted_by, posted_at
        ) VALUES ($1, $2, $3, $4, $5, $5, 'PURCHASE_INVOICE', 'POSTED', 'PKR', $6, $6, $7, 'AP_INVOICE', $8, $9, $9, CURRENT_TIMESTAMP)
      `,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          journalNumber,
          bill.invoice_date,
          total.toFixed(8),
          `Bill ${bill.invoice_number} from ${bill.party_name}`,
          id,
          req.session!.user_id,
        ],
      );

      // 2. Insert Lines
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
          grniAccId,
          total.toFixed(8),
          `Goods clearance for ${bill.party_name}`,
          bill.party_id,
          crypto.randomUUID(),
          apAccId,
        ],
      );

      // 3. Mark AP Invoice as POSTED
      await tx.query(
        "UPDATE ap_invoices SET status = 'POSTED', posted_journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
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
