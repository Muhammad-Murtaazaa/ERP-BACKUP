import type { Express, Request, Response } from 'express';
import { poBudgetCheck } from './budgets.js';
import { getSetting } from './config.js';
import { assertSupplierUsable } from './supplier.js';
import crypto from 'node:crypto';
import { Money } from '@omnysync/financial-engine';
import { AccountingPurpose, ErrorCode, Permission } from '@omnysync/contracts';
import { db, auditLogger, outboxService, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, sodViolation, validationError } from '../lib/errors.js';
import { arrayOf, dateOnly, decimal, optionalDate, optionalStr, optionalUuid, pagination, str, todayIso, toIsoDate, uuid } from '../lib/validate.js';
import { assertOrgRef, requireOrgRow } from '../lib/scope.js';
import { transition } from '../lib/state.js';
import { postJournal } from '../lib/posting.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { defaultWarehouseId, lockItems, postStockMovement } from '../lib/stock.js';
import { accountByCode, parseLines, priceLines, requireParty } from '../lib/trading.js';

const PO_READ = [Permission.PURCHASE_ORDER_MANAGE, Permission.AP_INVOICE_MANAGE, Permission.INVENTORY_MANAGE, Permission.PAYMENT_MANAGE, Permission.FINANCE_REPORTS_VIEW];
const AP_READ = [Permission.AP_INVOICE_MANAGE, Permission.PAYMENT_MANAGE, Permission.PURCHASE_ORDER_MANAGE, Permission.FINANCE_REPORTS_VIEW];

async function audit(req: Request, tx: any, action: string, type: string, id: string, before?: unknown, after?: unknown) {
  await auditLogger.record(
    { organization_id: req.session!.organization_id, user_id: req.session!.user_id, action, entity_type: type, entity_id: id, before_state: before as any, after_state: after as any, correlation_id: req.correlationId },
    tx,
  );
}

export function registerProcurementRoutes(app: Express): void {
  const poRead = requireAnyPermission(...PO_READ);
  const apRead = requireAnyPermission(...AP_READ);

  app.get('/api/procurement/orders', authenticate, poRead, async (req: Request, res: Response) => {
    const { limit, offset } = pagination(req.query as any);
    const r = await db.query(
      `SELECT po.*, p.name as party_name, p.code as party_code FROM purchase_orders po JOIN parties p ON p.id = po.party_id
       WHERE po.organization_id = $1 ORDER BY po.po_date DESC, po.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [req.session!.organization_id],
    );
    for (const po of r.rows) {
      po.lines = (
        await db.query(`SELECT pol.*, i.code as item_code, i.name as item_name FROM purchase_order_lines pol JOIN items i ON i.id = pol.item_id WHERE pol.purchase_order_id = $1 ORDER BY line_number`, [po.id])
      ).rows;
    }
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });

  app.post('/api/procurement/orders', authenticate, requirePermission(Permission.PURCHASE_ORDER_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const party_id = uuid(req.body?.party_id, 'party_id');
    const po_date = dateOnly(req.body?.po_date, 'po_date', { defaultValue: todayIso() });
    const expected_date = optionalDate(req.body?.expected_date, 'expected_date');
    if (expected_date && expected_date < po_date) throw validationError('expected_date cannot be before po_date', { field: 'expected_date' });
    const warehouse_id = optionalUuid(req.body?.warehouse_id, 'warehouse_id');
    await assertOrgRef(db, 'warehouses', warehouse_id, org, 'warehouse_id');
    await requireParty(db, org, party_id, 'VENDOR');
    await assertSupplierUsable(db, org, party_id);
    const priced = await priceLines(db, org, parseLines(req.body?.lines));
    const poId = crypto.randomUUID();
    const out = await db.transaction(async (tx) => {
      const poNumber = optionalStr(req.body?.po_number, 'po_number', 64) || (await nextDocumentNumber(tx, org, 'PO', po_date));
      await tx.query(
        `INSERT INTO purchase_orders (id, organization_id, legal_entity_id, party_id, po_number, po_date, expected_date, status, subtotal, tax_amount, total_amount, notes, created_by, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, $10, $11, $12, $13)`,
        [poId, org, req.session!.legal_entity_id, party_id, poNumber, po_date, expected_date, priced.subtotal, priced.tax_amount, priced.total_amount, optionalStr(req.body?.notes, 'notes'), req.session!.user_id, warehouse_id],
      );
      for (const l of priced.lines) {
        await tx.query(
          `INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [crypto.randomUUID(), poId, l.line_number, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description],
        );
      }
      await audit(req, tx, 'PURCHASE_ORDER_CREATED', 'PURCHASE_ORDER', poId, undefined, { po_number: poNumber, total_amount: priced.total_amount });
      return { id: poId, po_number: poNumber, status: 'DRAFT', subtotal: new Money(priced.subtotal).format(), total_amount: new Money(priced.total_amount).format() };
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/procurement/orders/:id/approve', authenticate, requirePermission(Permission.PURCHASE_ORDER_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const po = await requireOrgRow(tx, 'purchase_orders', req.params.id, org, 'Purchase order', { forUpdate: true });
      // Requester vs approver (FINANCIAL-CONTROLS.md segregation of duties).
      if (po.created_by === req.session!.user_id) throw sodViolation('Segregation of duties: the requester cannot approve their own purchase order');
      // Budget control (EPM): expense lines vs approved budget − actuals − open commitments.
      const control = await getSetting<string>(tx, org, 'epm.po_budget_control');
      const overBudget = control === 'OFF' ? [] : await poBudgetCheck(tx, org, po.id);
      if (overBudget.length && control === 'BLOCK') {
        const o = overBudget[0];
        throw new ApiError(409, ErrorCode.BUDGET_EXCEEDED, `Over budget on ${o.code} ${o.name}: available ${o.available}, this PO ${o.this_po}`, { over_budget: overBudget });
      }
      await transition(tx, { table: 'purchase_orders', id: po.id, organizationId: org, from: ['DRAFT'], to: 'APPROVED', label: 'Purchase order', set: { approved_by: req.session!.user_id, updated_at: new Date().toISOString() } });
      await audit(req, tx, 'PURCHASE_ORDER_APPROVED', 'PURCHASE_ORDER', po.id, { status: po.status }, { status: 'APPROVED', ...(overBudget.length ? { over_budget: overBudget } : {}) });
      return { id: po.id, status: 'APPROVED', budget_warnings: overBudget };
    });
    return ok(req, res, out);
  });

  app.post('/api/procurement/orders/:id/cancel', authenticate, requirePermission(Permission.PURCHASE_ORDER_MANAGE), async (req: Request, res: Response) => {
    const reason = str(req.body?.reason, 'reason', { max: 500 });
    const out = await db.transaction(async (tx) => {
      const po = await requireOrgRow(tx, 'purchase_orders', req.params.id, req.session!.organization_id, 'Purchase order', { forUpdate: true });
      const received = await tx.query(`SELECT 1 FROM purchase_order_lines WHERE purchase_order_id = $1 AND received_quantity > 0 LIMIT 1`, [po.id]);
      if (received.rows.length) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Purchase orders with receipts cannot be cancelled');
      await transition(tx, { table: 'purchase_orders', id: po.id, organizationId: req.session!.organization_id, from: ['DRAFT', 'APPROVED'], to: 'CANCELLED', label: 'Purchase order' });
      await audit(req, tx, 'PURCHASE_ORDER_CANCELLED', 'PURCHASE_ORDER', po.id, undefined, { reason });
      return { id: po.id, status: 'CANCELLED' };
    });
    return ok(req, res, out);
  });

  /**
   * Goods receipt (full or partial). Over-receipt is blocked; stock and the
   * Dr Inventory / Cr GRNI accrual are posted atomically per receipt.
   */
  app.post('/api/procurement/orders/:id/receive', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const receipt_date = dateOnly(req.body?.receipt_date, 'receipt_date', { defaultValue: todayIso() });
    const bodyWarehouse = optionalUuid(req.body?.warehouse_id, 'warehouse_id');
    await assertOrgRef(db, 'warehouses', bodyWarehouse, org, 'warehouse_id');
    const requested = req.body?.lines
      ? arrayOf<any>(req.body.lines, 'lines', { min: 1, max: 500 }).map((l, i) => ({ line_id: uuid(l?.line_id, `lines[${i}].line_id`), quantity: decimal(l?.quantity, `lines[${i}].quantity`, { sign: 'positive' }) }))
      : null;
    const out = await db.transaction(async (tx) => {
      const po = await requireOrgRow(tx, 'purchase_orders', req.params.id, org, 'Purchase order', { forUpdate: true });
      if (po.status !== 'APPROVED') throw new ApiError(409, ErrorCode.INVALID_STATE, `Only APPROVED purchase orders can be received (current: ${po.status})`);
      if (receipt_date < toIsoDate(po.po_date)) throw validationError('receipt_date cannot be before po_date', { field: 'receipt_date' });
      const lines = (await tx.query(`SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number FOR UPDATE`, [po.id])).rows;
      const items = await lockItems(tx, org, lines.map((l: any) => l.item_id));
      const warehouseId = bodyWarehouse || po.warehouse_id || (await defaultWarehouseId(tx, org));
      const receiptId = crypto.randomUUID();
      const defaultInv = await accountByCode(tx, org, '113001');
      const byAccount = new Map<string, Money>();
      let received = 0;
      for (const l of lines) {
        const remaining = new Money(l.quantity).sub(l.received_quantity);
        const want = requested ? requested.find((r) => r.line_id === l.id)?.quantity : remaining.isPositive() ? remaining.toFixed(8) : null;
        if (!want) continue;
        if (new Money(want).gt(remaining)) throw new ApiError(409, ErrorCode.OVER_ALLOCATION, `Over-receipt on line ${l.line_number}: remaining ${remaining.format(4)}`);
        const item = items.get(l.item_id);
        const value = new Money(want).mul(l.unit_price).round(2);
        if (item.item_type === 'INVENTORY') {
          await postStockMovement(tx, {
            organizationId: org,
            legalEntityId: po.legal_entity_id,
            itemId: l.item_id,
            warehouseId,
            movementType: 'RECEIPT',
            movementDate: receipt_date,
            quantity: new Money(want).toFixed(8),
            unitCost: new Money(l.unit_price).toFixed(8),
            referenceType: 'PURCHASE_ORDER',
            referenceId: po.id,
            description: `Goods receipt for ${po.po_number}`,
            revalue: true,
          });
          const acc = item.inventory_account_id || defaultInv;
          byAccount.set(acc, (byAccount.get(acc) || Money.zero()).add(value));
        } else {
          const acc = item.cogs_account_id || (await accountByCode(tx, org, '511001'));
          byAccount.set(acc, (byAccount.get(acc) || Money.zero()).add(value));
        }
        await tx.query(`UPDATE purchase_order_lines SET received_quantity = received_quantity + $1 WHERE id = $2`, [want, l.id]);
        received++;
      }
      if (received === 0) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Nothing left to receive on this purchase order');
      if (requested && requested.some((r) => !lines.find((l: any) => l.id === r.line_id))) throw validationError('Unknown purchase order line', { field: 'lines' });
      let total = Money.zero();
      const jLines: any[] = [];
      for (const [acc, amt] of byAccount) {
        total = total.add(amt);
        jLines.push({ account_id: acc, debit: amt.toFixed(8), description: `Receipt ${po.po_number}` });
      }
      jLines.push({ account_code: '211002', credit: total.toFixed(8), description: `GRNI accrual ${po.po_number}` });
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: po.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: receipt_date,
        purpose: AccountingPurpose.PURCHASE_RECEIPT,
        description: `Goods received for ${po.po_number}`,
        sourceType: 'GOODS_RECEIPT',
        sourceId: receiptId,
        sourceKey: `GOODS_RECEIPT:${receiptId}`,
        numberPrefix: 'JV-GRN',
        correlationId: req.correlationId,
        lines: jLines,
      });
      const after = (await tx.query(`SELECT BOOL_AND(received_quantity >= quantity) AS full FROM purchase_order_lines WHERE purchase_order_id = $1`, [po.id])).rows[0];
      const status = after.full ? 'RECEIVED' : 'APPROVED';
      await tx.query(`UPDATE purchase_orders SET status = $1, warehouse_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [status, warehouseId, po.id]);
      await audit(req, tx, 'GOODS_RECEIVED', 'PURCHASE_ORDER', po.id, { status: po.status }, { status, receipt_id: receiptId, value: total.format() });
      return { id: po.id, status, receipt_id: receiptId, journal_id: posted?.journalId ?? null, received_value: total.format() };
    });
    return ok(req, res, out);
  });

  // ---------------- AP invoices ----------------
  app.get('/api/ap/invoices', authenticate, apRead, async (req: Request, res: Response) => {
    const { limit, offset } = pagination(req.query as any);
    const r = await db.query(
      `SELECT ai.*, p.name as party_name, p.code as party_code FROM ap_invoices ai JOIN parties p ON p.id = ai.party_id
       WHERE ai.organization_id = $1 ORDER BY ai.invoice_date DESC, ai.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });

  app.post('/api/ap/invoices', authenticate, requirePermission(Permission.AP_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const party_id = uuid(req.body?.party_id, 'party_id');
    const purchase_order_id = optionalUuid(req.body?.purchase_order_id, 'purchase_order_id');
    const invoice_number = str(req.body?.invoice_number, 'invoice_number', { max: 64 });
    const invoice_date = dateOnly(req.body?.invoice_date, 'invoice_date', { defaultValue: todayIso() });
    const due_date = dateOnly(req.body?.due_date, 'due_date', { defaultValue: new Date(Date.parse(`${invoice_date}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10) });
    if (due_date < invoice_date) throw validationError('due_date cannot be before invoice_date', { field: 'due_date' });
    await requireParty(db, org, party_id, 'VENDOR');
    const inputLines = parseLines(req.body?.lines);
    const invoiceId = crypto.randomUUID();
    const out = await db.transaction(async (tx) => {
      // Duplicate supplier bill detection (same vendor + supplier invoice number).
      const dup = await tx.query(`SELECT id FROM ap_invoices WHERE organization_id = $1 AND party_id = $2 AND invoice_number = $3 AND status <> 'CANCELLED'`, [org, party_id, invoice_number]);
      if (dup.rows.length) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Supplier invoice ${invoice_number} was already recorded for this vendor`);
      let priceVariance = Money.zero();
      if (purchase_order_id) {
        const po = await requireOrgRow(tx, 'purchase_orders', purchase_order_id, org, 'Purchase order', { forUpdate: true });
        if (po.party_id !== party_id) throw validationError('Bill vendor must match the purchase order vendor', { field: 'party_id' });
        if (!['APPROVED', 'RECEIVED'].includes(po.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `Purchase order ${po.po_number} is ${po.status} and cannot be billed`);
        const poLines = (await tx.query(`SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number FOR UPDATE`, [po.id])).rows;
        // Three-way match: billed qty <= received qty - already billed.
        for (const l of inputLines) {
          const match =
            poLines.find((p: any) => p.id === l.source_line_id) ||
            poLines.find((p: any) => p.item_id === l.item_id && new Money(p.received_quantity).sub(p.billed_quantity).gte(l.quantity));
          if (!match) throw new ApiError(409, ErrorCode.OVER_ALLOCATION, `Billed quantity for item ${l.item_id} exceeds received-not-billed quantity on ${po.po_number}`);
          const open = new Money(match.received_quantity).sub(match.billed_quantity);
          if (new Money(l.quantity).gt(open)) throw new ApiError(409, ErrorCode.OVER_ALLOCATION, `Billed quantity exceeds received-not-billed quantity (${open.format(4)})`);
          match.billed_quantity = new Money(match.billed_quantity).add(l.quantity).toFixed(8);
          l.source_line_id = match.id;
          priceVariance = priceVariance.add(new Money(l.unit_price).sub(match.unit_price).mul(l.quantity).round(2));
          await tx.query(`UPDATE purchase_order_lines SET billed_quantity = $1 WHERE id = $2`, [match.billed_quantity, match.id]);
        }
        if (poLines.every((p: any) => new Money(p.billed_quantity).gte(p.quantity))) await tx.query(`UPDATE purchase_orders SET status = 'BILLED' WHERE id = $1`, [po.id]);
      }
      const priced = await priceLines(tx, org, inputLines);
      if (!purchase_order_id) {
        for (const l of priced.lines) {
          if (l.item.item_type === 'INVENTORY') throw validationError(`Inventory item ${l.item.code} must be billed against a purchase order receipt`, { field: 'purchase_order_id' });
        }
      }
      await tx.query(
        `INSERT INTO ap_invoices (id, organization_id, legal_entity_id, party_id, purchase_order_id, invoice_number, invoice_date, due_date, status,
           subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by, price_variance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, $10, $11, $11, $12, $13, $14)`,
        [invoiceId, org, req.session!.legal_entity_id, party_id, purchase_order_id, invoice_number, invoice_date, due_date, priced.subtotal, priced.tax_amount, priced.total_amount, optionalStr(req.body?.notes, 'notes'), req.session!.user_id, priceVariance.toFixed(8)],
      );
      for (const l of priced.lines) {
        await tx.query(
          `INSERT INTO ap_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description, purchase_order_line_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [crypto.randomUUID(), invoiceId, l.line_number, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description, l.source_line_id || null],
        );
      }
      await audit(req, tx, 'AP_INVOICE_CREATED', 'AP_INVOICE', invoiceId, undefined, { invoice_number, total_amount: priced.total_amount, price_variance: priceVariance.format() });
      return { id: invoiceId, invoice_number, status: 'DRAFT', total_amount: new Money(priced.total_amount).format(), price_variance: priceVariance.format() };
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/ap/invoices/:id/post', authenticate, requirePermission(Permission.AP_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const inv = await transition(tx, { table: 'ap_invoices', id: req.params.id, organizationId: org, from: ['DRAFT'], to: 'POSTED', label: 'AP invoice', set: { posted_by: req.session!.user_id, updated_at: new Date().toISOString() } });
      const lines = (
        await tx.query(
          `SELECT ail.*, i.cogs_account_id, i.item_type, pol.unit_price AS po_price FROM ap_invoice_lines ail JOIN items i ON i.id = ail.item_id
           LEFT JOIN purchase_order_lines pol ON pol.id = ail.purchase_order_line_id WHERE ail.invoice_id = $1`,
          [inv.id],
        )
      ).rows;
      const jLines: any[] = [];
      let lineSum = Money.zero();
      let taxSum = Money.zero();
      for (const l of lines) {
        lineSum = lineSum.add(l.line_total);
        taxSum = taxSum.add(l.tax_amount || '0');
        if (l.purchase_order_line_id) {
          // Clear GRNI at the receipt (PO) price; any price difference is a variance.
          const grni = new Money(l.po_price).mul(l.quantity).round(2);
          jLines.push({ account_code: '211002', debit: grni.toFixed(8), description: 'GRNI clearing' });
          const variance = new Money(l.line_total).sub(grni);
          if (!variance.isZero()) jLines.push({ account_code: '511002', debit: variance.toFixed(8), description: 'Purchase price variance' });
        } else {
          if (!l.cogs_account_id) throw new ApiError(400, ErrorCode.MAPPING_MISSING, 'Non-PO bill lines need an expense (COGS) account on the item');
          jLines.push({ account_id: l.cogs_account_id, debit: new Money(l.line_total).toFixed(8), description: 'Direct expense' });
        }
      }
      if (!lineSum.eq(inv.subtotal) || !lineSum.add(taxSum).eq(inv.total_amount)) throw new ApiError(409, ErrorCode.JOURNAL_UNBALANCED, 'Bill header totals do not match its lines');
      if (taxSum.isPositive()) jLines.push({ account_code: '114001', debit: taxSum.toFixed(8), description: 'Input tax' });
      jLines.push({ account_code: '211001', credit: new Money(inv.total_amount).toFixed(8), description: `AP ${inv.invoice_number}` });
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: inv.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: toIsoDate(inv.invoice_date),
        purpose: AccountingPurpose.PURCHASE_INVOICE,
        description: `Supplier bill ${inv.invoice_number}`,
        sourceType: 'AP_INVOICE',
        sourceId: inv.id,
        sourceKey: `AP_INVOICE:${inv.id}`,
        numberPrefix: 'JV-AP',
        correlationId: req.correlationId,
        lines: jLines,
      });
      await tx.query(`UPDATE ap_invoices SET posted_journal_id = $1 WHERE id = $2`, [posted?.journalId ?? null, inv.id]);
      return { id: inv.id, status: 'POSTED', posted_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });

  app.post('/api/ap/invoices/:id/cancel', authenticate, requirePermission(Permission.AP_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const out = await db.transaction(async (tx) => {
      const inv = await transition(tx, { table: 'ap_invoices', id: req.params.id, organizationId: req.session!.organization_id, from: ['DRAFT'], to: 'CANCELLED', label: 'AP invoice' });
      const lines = (await tx.query(`SELECT * FROM ap_invoice_lines WHERE invoice_id = $1 AND purchase_order_line_id IS NOT NULL`, [inv.id])).rows;
      for (const l of lines) await tx.query(`UPDATE purchase_order_lines SET billed_quantity = billed_quantity - $1 WHERE id = $2`, [l.quantity, l.purchase_order_line_id]);
      if (inv.purchase_order_id) await tx.query(`UPDATE purchase_orders SET status = 'RECEIVED' WHERE id = $1 AND status = 'BILLED'`, [inv.purchase_order_id]);
      await audit(req, tx, 'AP_INVOICE_CANCELLED', 'AP_INVOICE', inv.id);
      return { id: inv.id, status: 'CANCELLED' };
    });
    return ok(req, res, out);
  });
}
