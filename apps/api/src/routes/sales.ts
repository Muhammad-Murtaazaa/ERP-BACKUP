import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { Money } from '@omnysync/financial-engine';
import { AccountingPurpose, ErrorCode, Permission } from '@omnysync/contracts';
import { db, auditLogger, outboxService, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { dateOnly, optionalDate, optionalStr, optionalUuid, pagination, str, todayIso, toIsoDate, uuid } from '../lib/validate.js';
import { assertOrgRef, requireOrgRow } from '../lib/scope.js';
import { transition } from '../lib/state.js';
import { postJournal } from '../lib/posting.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { defaultWarehouseId, lockItems, postStockMovement } from '../lib/stock.js';
import { accountByCode, assertCreditLimit, parseLines, priceLines, requireParty } from '../lib/trading.js';

const SALES_READ = [Permission.SALES_ORDER_MANAGE, Permission.AR_INVOICE_MANAGE, Permission.PAYMENT_MANAGE, Permission.INVENTORY_MANAGE, Permission.FINANCE_REPORTS_VIEW];
const AR_READ = [Permission.AR_INVOICE_MANAGE, Permission.PAYMENT_MANAGE, Permission.SALES_ORDER_MANAGE, Permission.FINANCE_REPORTS_VIEW];

async function audit(req: Request, tx: any, action: string, type: string, id: string, before?: unknown, after?: unknown) {
  await auditLogger.record(
    { organization_id: req.session!.organization_id, user_id: req.session!.user_id, action, entity_type: type, entity_id: id, before_state: before as any, after_state: after as any, correlation_id: req.correlationId },
    tx,
  );
}

export function registerSalesRoutes(app: Express): void {
  const salesRead = requireAnyPermission(...SALES_READ);
  const arRead = requireAnyPermission(...AR_READ);

  app.get('/api/sales/orders', authenticate, salesRead, async (req: Request, res: Response) => {
    const { limit, offset } = pagination(req.query as any);
    const params: any[] = [req.session!.organization_id];
    let where = 'so.organization_id = $1';
    if (req.query.status) {
      params.push(String(req.query.status));
      where += ` AND so.status = $${params.length}`;
    }
    const r = await db.query(
      `SELECT so.*, p.name as party_name, p.code as party_code FROM sales_orders so JOIN parties p ON p.id = so.party_id
       WHERE ${where} ORDER BY so.order_date DESC, so.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });

  app.get('/api/sales/orders/:id', authenticate, salesRead, async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT so.*, p.name as party_name, p.code as party_code FROM sales_orders so JOIN parties p ON p.id = so.party_id
       WHERE so.id::text = $1 AND so.organization_id = $2`,
      [req.params.id, req.session!.organization_id],
    );
    if (!r.rows[0]) throw new ApiError(404, ErrorCode.RESOURCE_NOT_FOUND, 'Sales order not found');
    const lines = await db.query(
      `SELECT sol.*, i.code as item_code, i.name as item_name, i.uom FROM sales_order_lines sol JOIN items i ON i.id = sol.item_id
       WHERE sol.sales_order_id = $1 ORDER BY sol.line_number ASC`,
      [r.rows[0].id],
    );
    return ok(req, res, { ...r.rows[0], lines: lines.rows });
  });

  app.post('/api/sales/orders', authenticate, requirePermission(Permission.SALES_ORDER_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const party_id = uuid(req.body?.party_id, 'party_id');
    const order_date = dateOnly(req.body?.order_date, 'order_date', { defaultValue: todayIso() });
    const delivery_date = optionalDate(req.body?.delivery_date, 'delivery_date');
    if (delivery_date && delivery_date < order_date) throw validationError('delivery_date cannot be before order_date', { field: 'delivery_date' });
    const warehouse_id = optionalUuid(req.body?.warehouse_id, 'warehouse_id');
    await assertOrgRef(db, 'warehouses', warehouse_id, org, 'warehouse_id');
    await requireParty(db, org, party_id, 'CUSTOMER');
    const priced = await priceLines(db, org, parseLines(req.body?.lines));
    const orderId = crypto.randomUUID();
    const out = await db.transaction(async (tx) => {
      const orderNumber = optionalStr(req.body?.order_number, 'order_number', 64) || (await nextDocumentNumber(tx, org, 'SO', order_date));
      await tx.query(
        `INSERT INTO sales_orders (id, organization_id, legal_entity_id, party_id, order_number, order_date, delivery_date, status,
           subtotal, tax_amount, total_amount, notes, created_by, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, $10, $11, $12, $13)`,
        [orderId, org, req.session!.legal_entity_id, party_id, orderNumber, order_date, delivery_date, priced.subtotal, priced.tax_amount, priced.total_amount, optionalStr(req.body?.notes, 'notes'), req.session!.user_id, warehouse_id],
      );
      for (const l of priced.lines) {
        await tx.query(
          `INSERT INTO sales_order_lines (id, sales_order_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [crypto.randomUUID(), orderId, l.line_number, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description],
        );
      }
      await audit(req, tx, 'SALES_ORDER_CREATED', 'SALES_ORDER', orderId, undefined, { order_number: orderNumber, total_amount: priced.total_amount });
      return { id: orderId, order_number: orderNumber, status: 'DRAFT', subtotal: new Money(priced.subtotal).format(), tax_amount: new Money(priced.tax_amount).format(), total_amount: new Money(priced.total_amount).format() };
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/sales/orders/:id/confirm', authenticate, requirePermission(Permission.SALES_ORDER_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const so = await requireOrgRow(tx, 'sales_orders', req.params.id, org, 'Sales order', { forUpdate: true });
      const party = await requireParty(tx, org, so.party_id, 'CUSTOMER');
      await assertCreditLimit(tx, org, party, so.total_amount, so.id);
      await transition(tx, { table: 'sales_orders', id: so.id, organizationId: org, from: ['DRAFT'], to: 'CONFIRMED', label: 'Sales order', set: { confirmed_by: req.session!.user_id, updated_at: new Date().toISOString() } });
      await audit(req, tx, 'SALES_ORDER_CONFIRMED', 'SALES_ORDER', so.id, { status: so.status }, { status: 'CONFIRMED' });
      return { id: so.id, status: 'CONFIRMED' };
    });
    return ok(req, res, out);
  });

  app.post('/api/sales/orders/:id/cancel', authenticate, requirePermission(Permission.SALES_ORDER_MANAGE), async (req: Request, res: Response) => {
    const reason = str(req.body?.reason, 'reason', { max: 500 });
    const out = await db.transaction(async (tx) => {
      const so = await transition(tx, { table: 'sales_orders', id: req.params.id, organizationId: req.session!.organization_id, from: ['DRAFT', 'CONFIRMED'], to: 'CANCELLED', label: 'Sales order', set: { updated_at: new Date().toISOString() } });
      await audit(req, tx, 'SALES_ORDER_CANCELLED', 'SALES_ORDER', so.id, undefined, { reason });
      return { id: so.id, status: 'CANCELLED' };
    });
    return ok(req, res, out);
  });

  /**
   * Ship the order: stock leaves the warehouse and COGS is recognised, atomically.
   * Previously this could run repeatedly (double stock issue + COGS), from any status,
   * with no availability check and using a branch id as the warehouse.
   */
  app.post('/api/sales/orders/:id/fulfill', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const shipment_date = dateOnly(req.body?.shipment_date, 'shipment_date', { defaultValue: todayIso() });
    const bodyWarehouse = optionalUuid(req.body?.warehouse_id, 'warehouse_id');
    await assertOrgRef(db, 'warehouses', bodyWarehouse, org, 'warehouse_id');
    const out = await db.transaction(async (tx) => {
      const so = await transition(tx, { table: 'sales_orders', id: req.params.id, organizationId: org, from: ['CONFIRMED'], to: 'FULFILLED', label: 'Sales order', set: { updated_at: new Date().toISOString() } });
      if (shipment_date < toIsoDate(so.order_date)) throw validationError('shipment_date cannot be before order_date', { field: 'shipment_date' });
      const warehouseId = bodyWarehouse || so.warehouse_id || (await defaultWarehouseId(tx, org));
      const lines = (await tx.query(`SELECT * FROM sales_order_lines WHERE sales_order_id = $1 ORDER BY line_number`, [so.id])).rows;
      const items = await lockItems(tx, org, lines.map((l: any) => l.item_id));
      const cogsByAccount = new Map<string, { cogs: string; inv: string; amount: Money }>();
      const defaultCogs = await accountByCode(tx, org, '511001');
      const defaultInv = await accountByCode(tx, org, '113001');
      for (const l of lines) {
        const item = items.get(l.item_id);
        if (item.item_type === 'INVENTORY') {
          const cost = new Money(item.unit_cost || '0');
          const mv = await postStockMovement(tx, {
            organizationId: org,
            legalEntityId: so.legal_entity_id,
            itemId: l.item_id,
            warehouseId,
            movementType: 'SHIPMENT',
            movementDate: shipment_date,
            quantity: new Money(l.quantity).negated().toFixed(8),
            unitCost: cost.toFixed(8),
            referenceType: 'SALES_ORDER',
            referenceId: so.id,
            description: `Shipment for ${so.order_number}`,
          });
          const value = new Money(mv.total_value).abs(); // FIFO-aware: GL matches the stock movement value
          const cogsAcc = item.cogs_account_id || defaultCogs;
          const invAcc = item.inventory_account_id || defaultInv;
          const key = `${cogsAcc}|${invAcc}`;
          const cur = cogsByAccount.get(key) || { cogs: cogsAcc, inv: invAcc, amount: Money.zero() };
          cur.amount = cur.amount.add(value);
          cogsByAccount.set(key, cur);
        }
        await tx.query('UPDATE sales_order_lines SET fulfilled_quantity = quantity WHERE id = $1', [l.id]);
      }
      const jLines: any[] = [];
      for (const v of cogsByAccount.values()) {
        const amt = v.amount.round(2).toFixed(8);
        jLines.push({ account_id: v.cogs, debit: amt, description: 'Cost of goods sold' });
        jLines.push({ account_id: v.inv, credit: amt, description: 'Inventory issued' });
      }
      const posted = jLines.length
        ? await postJournal(tx, auditLogger, outboxService, {
            organizationId: org,
            legalEntityId: so.legal_entity_id,
            userId: req.session!.user_id,
            postingDate: shipment_date,
            purpose: AccountingPurpose.INVENTORY_ISSUE,
            description: `COGS for order ${so.order_number}`,
            sourceType: 'SALES_ORDER',
            sourceId: so.id,
            sourceKey: `SO_FULFILLMENT:${so.id}`,
            numberPrefix: 'JV-COGS',
            correlationId: req.correlationId,
            lines: jLines,
          })
        : null;
      await tx.query(`UPDATE sales_orders SET warehouse_id = $1, cogs_journal_id = $2 WHERE id = $3`, [warehouseId, posted?.journalId ?? null, so.id]);
      await audit(req, tx, 'SALES_ORDER_FULFILLED', 'SALES_ORDER', so.id, { status: 'CONFIRMED' }, { status: 'FULFILLED', warehouse_id: warehouseId, cogs_journal_id: posted?.journalId ?? null });
      return { id: so.id, status: 'FULFILLED', cogs_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });

  // ---------------- AR invoices ----------------
  app.get('/api/ar/invoices', authenticate, arRead, async (req: Request, res: Response) => {
    const { limit, offset } = pagination(req.query as any);
    const r = await db.query(
      `SELECT ai.*, p.name as party_name, p.code as party_code FROM ar_invoices ai JOIN parties p ON p.id = ai.party_id
       WHERE ai.organization_id = $1 ORDER BY ai.invoice_date DESC, ai.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length, limit, offset });
  });

  app.get('/api/ar/invoices/:id', authenticate, arRead, async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT ai.*, p.name as party_name, p.code as party_code FROM ar_invoices ai JOIN parties p ON p.id = ai.party_id
       WHERE ai.id::text = $1 AND ai.organization_id = $2`,
      [req.params.id, req.session!.organization_id],
    );
    if (!r.rows[0]) throw new ApiError(404, ErrorCode.RESOURCE_NOT_FOUND, 'AR invoice not found');
    const lines = await db.query(
      `SELECT ail.*, i.code as item_code, i.name as item_name FROM ar_invoice_lines ail JOIN items i ON i.id = ail.item_id
       WHERE ail.invoice_id = $1 ORDER BY ail.line_number ASC`,
      [r.rows[0].id],
    );
    const allocations = await db.query(
      `SELECT a.*, pm.payment_number FROM allocations a JOIN payments pm ON pm.id = a.payment_id
       WHERE a.invoice_id = $1 AND a.invoice_type = 'AR' AND a.reversed_at IS NULL ORDER BY a.allocated_date`,
      [r.rows[0].id],
    );
    return ok(req, res, { ...r.rows[0], lines: lines.rows, allocations: allocations.rows });
  });

  app.post('/api/ar/invoices', authenticate, requirePermission(Permission.AR_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const party_id = uuid(req.body?.party_id, 'party_id');
    const sales_order_id = optionalUuid(req.body?.sales_order_id, 'sales_order_id');
    const invoice_date = dateOnly(req.body?.invoice_date, 'invoice_date', { defaultValue: todayIso() });
    const due_date = dateOnly(req.body?.due_date, 'due_date', {
      defaultValue: new Date(Date.parse(`${invoice_date}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10),
    });
    if (due_date < invoice_date) throw validationError('due_date cannot be before invoice_date', { field: 'due_date' });
    await requireParty(db, org, party_id, 'CUSTOMER');
    const inputLines = parseLines(req.body?.lines);
    const invoiceId = crypto.randomUUID();

    const out = await db.transaction(async (tx) => {
      // Order-linked invoices can only bill what was ordered and not yet invoiced.
      if (sales_order_id) {
        const so = await requireOrgRow(tx, 'sales_orders', sales_order_id, org, 'Sales order', { forUpdate: true });
        if (so.party_id !== party_id) throw validationError('Invoice customer must match the sales order customer', { field: 'party_id' });
        if (!['CONFIRMED', 'FULFILLED'].includes(so.status)) throw new ApiError(409, ErrorCode.INVALID_STATE, `Sales order ${so.order_number} is ${so.status} and cannot be invoiced`);
        const soLines = (await tx.query(`SELECT * FROM sales_order_lines WHERE sales_order_id = $1 ORDER BY line_number FOR UPDATE`, [so.id])).rows;
        for (const l of inputLines) {
          const match =
            soLines.find((s: any) => s.id === l.source_line_id) ||
            soLines.find((s: any) => s.item_id === l.item_id && new Money(s.quantity).sub(s.invoiced_quantity).gte(l.quantity));
          if (!match) throw new ApiError(409, ErrorCode.OVER_ALLOCATION, `Line for item ${l.item_id} exceeds the un-invoiced quantity on ${so.order_number}`);
          const remaining = new Money(match.quantity).sub(match.invoiced_quantity);
          if (new Money(l.quantity).gt(remaining)) throw new ApiError(409, ErrorCode.OVER_ALLOCATION, `Invoiced quantity exceeds remaining order quantity (${remaining.format(4)})`);
          match.invoiced_quantity = new Money(match.invoiced_quantity).add(l.quantity).toFixed(8);
          l.source_line_id = match.id;
          await tx.query(`UPDATE sales_order_lines SET invoiced_quantity = $1 WHERE id = $2`, [match.invoiced_quantity, match.id]);
        }
        if (soLines.every((s: any) => new Money(s.invoiced_quantity).gte(s.quantity)) && so.status === 'FULFILLED') {
          await tx.query(`UPDATE sales_orders SET status = 'INVOICED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [so.id]);
        }
      }
      const priced = await priceLines(tx, org, inputLines);
      const invoiceNumber = optionalStr(req.body?.invoice_number, 'invoice_number', 64) || (await nextDocumentNumber(tx, org, 'INV', invoice_date));
      await tx.query(
        `INSERT INTO ar_invoices (id, organization_id, legal_entity_id, party_id, sales_order_id, invoice_number, invoice_date, due_date, status,
           subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, $10, $11, $11, $12, $13)`,
        [invoiceId, org, req.session!.legal_entity_id, party_id, sales_order_id, invoiceNumber, invoice_date, due_date, priced.subtotal, priced.tax_amount, priced.total_amount, optionalStr(req.body?.notes, 'notes'), req.session!.user_id],
      );
      for (const l of priced.lines) {
        await tx.query(
          `INSERT INTO ar_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, tax_amount, description, sales_order_line_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [crypto.randomUUID(), invoiceId, l.line_number, l.item_id, l.quantity, l.unit_price, l.line_total, l.tax_amount, l.description, l.source_line_id || null],
        );
      }
      await audit(req, tx, 'AR_INVOICE_CREATED', 'AR_INVOICE', invoiceId, undefined, { invoice_number: invoiceNumber, total_amount: priced.total_amount });
      return { id: invoiceId, invoice_number: invoiceNumber, status: 'DRAFT', subtotal: new Money(priced.subtotal).format(), tax_amount: new Money(priced.tax_amount).format(), total_amount: new Money(priced.total_amount).format() };
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/ar/invoices/:id/post', authenticate, requirePermission(Permission.AR_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      // Atomic DRAFT -> POSTED: re-posting a POSTED/PAID invoice is rejected.
      const inv = await transition(tx, { table: 'ar_invoices', id: req.params.id, organizationId: org, from: ['DRAFT'], to: 'POSTED', label: 'AR invoice', set: { posted_by: req.session!.user_id, updated_at: new Date().toISOString() } });
      const lines = (await tx.query(`SELECT ail.*, i.sales_account_id FROM ar_invoice_lines ail JOIN items i ON i.id = ail.item_id WHERE ail.invoice_id = $1`, [inv.id])).rows;
      const defaultRevenue = await accountByCode(tx, org, '411001');
      const revenueByAccount = new Map<string, Money>();
      let lineSum = Money.zero();
      let taxSum = Money.zero();
      for (const l of lines) {
        const acc = l.sales_account_id || defaultRevenue;
        revenueByAccount.set(acc, (revenueByAccount.get(acc) || Money.zero()).add(l.line_total));
        lineSum = lineSum.add(l.line_total);
        taxSum = taxSum.add(l.tax_amount || '0');
      }
      // Header must equal its lines (tamper/drift guard).
      if (!lineSum.eq(inv.subtotal) || !taxSum.eq(inv.tax_amount) || !lineSum.add(taxSum).eq(inv.total_amount)) {
        throw new ApiError(409, ErrorCode.JOURNAL_UNBALANCED, 'Invoice header totals do not match its lines');
      }
      const jLines: any[] = [{ account_code: '112001', debit: new Money(inv.total_amount).toFixed(8), description: `AR ${inv.invoice_number}` }];
      for (const [acc, amt] of revenueByAccount) jLines.push({ account_id: acc, credit: amt.toFixed(8), description: `Revenue ${inv.invoice_number}` });
      if (taxSum.isPositive()) jLines.push({ account_code: '212001', credit: taxSum.toFixed(8), description: `Output tax ${inv.invoice_number}` });
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: inv.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: toIsoDate(inv.invoice_date),
        purpose: AccountingPurpose.SALES_INVOICE,
        description: `Customer invoice ${inv.invoice_number}`,
        sourceType: 'AR_INVOICE',
        sourceId: inv.id,
        sourceKey: `AR_INVOICE:${inv.id}`,
        numberPrefix: 'JV-AR',
        correlationId: req.correlationId,
        lines: jLines,
      });
      await tx.query(`UPDATE ar_invoices SET posted_journal_id = $1, outstanding_amount = total_amount WHERE id = $2`, [posted?.journalId ?? null, inv.id]);
      return { id: inv.id, status: 'POSTED', posted_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });

  app.post('/api/ar/invoices/:id/cancel', authenticate, requirePermission(Permission.AR_INVOICE_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const inv = await transition(tx, { table: 'ar_invoices', id: req.params.id, organizationId: org, from: ['DRAFT'], to: 'CANCELLED', label: 'AR invoice', set: { updated_at: new Date().toISOString() } });
      // Release invoiced quantities back to the order.
      const lines = (await tx.query(`SELECT * FROM ar_invoice_lines WHERE invoice_id = $1 AND sales_order_line_id IS NOT NULL`, [inv.id])).rows;
      for (const l of lines) await tx.query(`UPDATE sales_order_lines SET invoiced_quantity = invoiced_quantity - $1 WHERE id = $2`, [l.quantity, l.sales_order_line_id]);
      if (inv.sales_order_id) await tx.query(`UPDATE sales_orders SET status = 'FULFILLED' WHERE id = $1 AND status = 'INVOICED'`, [inv.sales_order_id]);
      await audit(req, tx, 'AR_INVOICE_CANCELLED', 'AR_INVOICE', inv.id);
      return { id: inv.id, status: 'CANCELLED' };
    });
    return ok(req, res, out);
  });

  /** Receivables ageing (current, 1-30, 31-60, 61-90, 90+) as of a date. */
  app.get('/api/ar/aging', authenticate, arRead, async (req: Request, res: Response) => {
    const asOf = dateOnly(req.query.as_of_date, 'as_of_date', { defaultValue: todayIso() });
    const r = await db.query(
      `SELECT ai.id, ai.invoice_number, ai.due_date, ai.outstanding_amount, p.id as party_id, p.name as party_name
       FROM ar_invoices ai JOIN parties p ON p.id = ai.party_id
       WHERE ai.organization_id = $1 AND ai.status IN ('POSTED','PARTIALLY_PAID') AND ai.invoice_date <= $2`,
      [req.session!.organization_id, asOf],
    );
    const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
    const byParty = new Map<string, any>();
    for (const row of r.rows) {
      const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${toIsoDate(row.due_date)}T00:00:00Z`)) / 86400000);
      const b = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
      const p = byParty.get(row.party_id) || { party_id: row.party_id, party_name: row.party_name, total: Money.zero(), ...Object.fromEntries(buckets.map((k) => [k, Money.zero()])) };
      p[b] = p[b].add(row.outstanding_amount);
      p.total = p.total.add(row.outstanding_amount);
      byParty.set(row.party_id, p);
    }
    const rows = [...byParty.values()].map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v instanceof Money ? v.format() : v])));
    return ok(req, res, rows, 200, { as_of_date: asOf });
  });
}
