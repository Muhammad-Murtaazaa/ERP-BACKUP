import type { Express, Request, Response } from 'express';
import { Money, InventoryReconciliationEngine } from '@omnysync/financial-engine';
import { AccountingPurpose, ErrorCode, Permission } from '@omnysync/contracts';
import { db, auditLogger, outboxService, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError, sodViolation } from '../lib/errors.js';
import { arrayOf, bool, dateOnly, decimal, oneOf, optionalDate, optionalStr, optionalUuid, str, toIsoDate, todayIso, uuid } from '../lib/validate.js';
import { assertOrgRef, requireOrgRow } from '../lib/scope.js';
import { transition } from '../lib/state.js';
import { postJournal } from '../lib/posting.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { lockItems, onHand, postStockMovement } from '../lib/stock.js';

export const INVENTORY_READ = [
  Permission.INVENTORY_MANAGE,
  Permission.WAREHOUSE_MANAGE,
  Permission.INVENTORY_TRANSFER,
  Permission.INVENTORY_COUNT,
  Permission.INVENTORY_ADJUST,
  Permission.ITEMS_MANAGE,
  Permission.SALES_ORDER_MANAGE,
  Permission.PURCHASE_ORDER_MANAGE,
  Permission.WORK_ORDER_MANAGE,
  Permission.POS_TERMINAL,
  Permission.FINANCE_REPORTS_VIEW,
];

async function audit(req: Request, tx: any, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown) {
  await auditLogger.record(
    {
      organization_id: req.session!.organization_id,
      user_id: req.session!.user_id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before_state: before as any,
      after_state: after as any,
      correlation_id: req.correlationId,
    },
    tx,
  );
}

export function registerInventoryRoutes(app: Express): void {
  const invRead = requireAnyPermission(...INVENTORY_READ);

  // ---------- Warehouses, zones, bins ----------
  app.get('/api/inventory/warehouses', authenticate, invRead, async (req: Request, res: Response) => {
    const warehouses = (await db.query(`SELECT * FROM warehouses WHERE organization_id = $1 ORDER BY is_default DESC, name ASC`, [req.session!.organization_id])).rows;
    for (const wh of warehouses) {
      wh.zones = (await db.query(`SELECT * FROM warehouse_zones WHERE warehouse_id = $1 ORDER BY code ASC`, [wh.id])).rows;
      wh.bins = (
        await db.query(
          `SELECT b.*, z.name as zone_name FROM warehouse_bins b LEFT JOIN warehouse_zones z ON b.zone_id = z.id WHERE b.warehouse_id = $1 ORDER BY b.bin_code ASC`,
          [wh.id],
        )
      ).rows;
    }
    return ok(req, res, warehouses, 200, { total_count: warehouses.length });
  });

  app.post('/api/inventory/warehouses', authenticate, requirePermission(Permission.WAREHOUSE_MANAGE), async (req: Request, res: Response) => {
    const code = str(req.body?.code, 'code', { max: 32 });
    const name = str(req.body?.name, 'name', { max: 255 });
    const address = optionalStr(req.body?.address, 'address', 1000);
    const is_default = bool(req.body?.is_default, false);
    const wh = await db.transaction(async (tx) => {
      // Only one default warehouse per organisation.
      if (is_default) await tx.query(`UPDATE warehouses SET is_default = false WHERE organization_id = $1`, [req.session!.organization_id]);
      const r = await tx.query(`INSERT INTO warehouses (code, name, address, is_default, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [
        code,
        name,
        address,
        is_default,
        req.session!.organization_id,
      ]);
      await audit(req, tx, 'WAREHOUSE_CREATED', 'WAREHOUSE', r.rows[0].id, undefined, { code, name, is_default });
      return r.rows[0];
    });
    return ok(req, res, wh, 201);
  });

  app.post('/api/inventory/warehouses/:id/zones', authenticate, requirePermission(Permission.WAREHOUSE_MANAGE), async (req: Request, res: Response) => {
    // Previously the warehouse id was never checked against the caller's organisation.
    await requireOrgRow(db, 'warehouses', req.params.id, req.session!.organization_id, 'Warehouse');
    const code = str(req.body?.code, 'code', { max: 32 });
    const name = str(req.body?.name, 'name', { max: 255 });
    const zone_type = oneOf(req.body?.zone_type, 'zone_type', ['STORAGE', 'RECEIVING', 'SHIPPING', 'QUARANTINE', 'PRODUCTION', 'RETURNS'] as const, 'STORAGE');
    const r = await db.query(`INSERT INTO warehouse_zones (warehouse_id, code, name, zone_type) VALUES ($1, $2, $3, $4) RETURNING *`, [req.params.id, code, name, zone_type]);
    return ok(req, res, r.rows[0], 201);
  });

  app.post('/api/inventory/warehouses/:id/bins', authenticate, requirePermission(Permission.WAREHOUSE_MANAGE), async (req: Request, res: Response) => {
    await requireOrgRow(db, 'warehouses', req.params.id, req.session!.organization_id, 'Warehouse');
    const bin_code = str(req.body?.bin_code, 'bin_code', { max: 64 });
    const zone_id = optionalUuid(req.body?.zone_id, 'zone_id');
    if (zone_id) {
      const z = await db.query(`SELECT 1 FROM warehouse_zones WHERE id = $1 AND warehouse_id = $2`, [zone_id, req.params.id]);
      if (z.rows.length === 0) throw validationError('Zone does not belong to this warehouse', { field: 'zone_id' });
    }
    const cap = req.body?.max_weight_capacity == null || req.body?.max_weight_capacity === '' ? null : decimal(req.body.max_weight_capacity, 'max_weight_capacity', { sign: 'nonNegative' });
    const r = await db.query(`INSERT INTO warehouse_bins (warehouse_id, zone_id, bin_code, max_weight_capacity) VALUES ($1, $2, $3, $4) RETURNING *`, [
      req.params.id,
      zone_id,
      bin_code,
      cap,
    ]);
    return ok(req, res, r.rows[0], 201);
  });

  // ---------- Stock on hand (org-wide or per warehouse) ----------
  app.get('/api/inventory/stock', authenticate, invRead, async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const warehouse_id = optionalUuid(req.query.warehouse_id, 'warehouse_id');
    await assertOrgRef(db, 'warehouses', warehouse_id, org, 'warehouse_id');
    const params: any[] = [org];
    let locFilter = '';
    if (warehouse_id) {
      params.push(warehouse_id);
      // Legacy movements without a location belong to the default warehouse.
      locFilter = ` AND (sm.location_id = $2 OR (sm.location_id IS NULL AND EXISTS (SELECT 1 FROM warehouses w WHERE w.id = $2 AND w.is_default = true)))`;
    }
    const r = await db.query(
      `SELECT i.id as item_id, i.code as item_code, i.name as item_name, i.uom, i.unit_cost, i.unit_price, i.barcode,
              i.reorder_point, i.reorder_qty,
              COALESCE(SUM(sm.quantity), 0) as on_hand_qty, COALESCE(SUM(sm.total_value), 0) as total_valuation
       FROM items i LEFT JOIN stock_movements sm ON sm.item_id = i.id AND sm.organization_id = i.organization_id${locFilter}
       WHERE i.organization_id = $1 AND i.item_type = 'INVENTORY'
       GROUP BY i.id ORDER BY i.name ASC`,
      params,
    );
    const rows = r.rows.map((x: any) => ({
      ...x,
      below_reorder_point: new Money(x.reorder_point || '0').isPositive() && new Money(x.on_hand_qty).lte(x.reorder_point),
    }));
    return ok(req, res, rows, 200, { total_count: rows.length, warehouse_id });
  });

  /** Movement history (stock card) for one item. */
  app.get('/api/inventory/items/:id/movements', authenticate, invRead, async (req: Request, res: Response) => {
    await requireOrgRow(db, 'items', req.params.id, req.session!.organization_id, 'Item');
    const r = await db.query(
      `SELECT sm.*, w.code as warehouse_code FROM stock_movements sm LEFT JOIN warehouses w ON w.id = sm.location_id
       WHERE sm.organization_id = $1 AND sm.item_id = $2 ORDER BY sm.movement_date ASC, sm.created_at ASC LIMIT 5000`,
      [req.session!.organization_id, req.params.id],
    );
    let running = new Money(0);
    const rows = r.rows.map((m: any) => {
      running = running.add(m.quantity);
      return { ...m, running_qty: running.toFixed(8) };
    });
    return ok(req, res, rows, 200, { total_count: rows.length });
  });

  // ---------- Lots & serials ----------
  app.get('/api/inventory/lots', authenticate, invRead, async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT l.*, i.code as item_code, i.name as item_name FROM item_lots l JOIN items i ON l.item_id = i.id
       WHERE l.organization_id = $1 ORDER BY l.created_at DESC`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  app.post('/api/inventory/lots', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
    const item_id = uuid(req.body?.item_id, 'item_id');
    await assertOrgRef(db, 'items', item_id, req.session!.organization_id, 'item_id');
    const lot_number = str(req.body?.lot_number, 'lot_number', { max: 64 });
    const manufacture_date = optionalDate(req.body?.manufacture_date, 'manufacture_date');
    const expiry_date = optionalDate(req.body?.expiry_date, 'expiry_date');
    if (manufacture_date && expiry_date && expiry_date < manufacture_date) throw validationError('expiry_date cannot be before manufacture_date', { field: 'expiry_date' });
    const status = oneOf(req.body?.status, 'status', ['AVAILABLE', 'QUARANTINE', 'EXPIRED', 'DEPLETED', 'REJECTED'] as const, 'AVAILABLE');
    const r = await db.query(
      `INSERT INTO item_lots (item_id, lot_number, manufacture_date, expiry_date, status, organization_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [item_id, lot_number, manufacture_date, expiry_date, status, req.session!.organization_id],
    );
    return ok(req, res, r.rows[0], 201);
  });

  app.get('/api/inventory/serials', authenticate, invRead, async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT s.*, i.code as item_code, i.name as item_name, w.name as warehouse_name, b.bin_code
       FROM item_serials s JOIN items i ON s.item_id = i.id
       LEFT JOIN warehouses w ON s.warehouse_id = w.id LEFT JOIN warehouse_bins b ON s.bin_id = b.id
       WHERE s.organization_id = $1 ORDER BY s.created_at DESC`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  app.post('/api/inventory/serials', authenticate, requirePermission(Permission.INVENTORY_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const item_id = uuid(req.body?.item_id, 'item_id');
    const serial_number = str(req.body?.serial_number, 'serial_number', { max: 128 });
    const warehouse_id = optionalUuid(req.body?.warehouse_id, 'warehouse_id');
    const bin_id = optionalUuid(req.body?.bin_id, 'bin_id');
    await assertOrgRef(db, 'items', item_id, org, 'item_id');
    await assertOrgRef(db, 'warehouses', warehouse_id, org, 'warehouse_id');
    if (bin_id) {
      const b = await db.query(`SELECT 1 FROM warehouse_bins b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.id = $1 AND w.organization_id = $2`, [bin_id, org]);
      if (b.rows.length === 0) throw validationError('Bin not found', { field: 'bin_id' });
    }
    const status = oneOf(req.body?.status, 'status', ['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'SCRAPPED'] as const, 'IN_STOCK');
    const r = await db.query(
      `INSERT INTO item_serials (item_id, serial_number, warehouse_id, bin_id, status, organization_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [item_id, serial_number, warehouse_id, bin_id, status, org],
    );
    return ok(req, res, r.rows[0], 201);
  });

  // ---------- Inter-warehouse transfers ----------
  app.get('/api/inventory/transfers', authenticate, invRead, async (req: Request, res: Response) => {
    const transfers = (
      await db.query(
        `SELECT t.*, sw.name as source_warehouse_name, dw.name as destination_warehouse_name
         FROM stock_transfers t JOIN warehouses sw ON t.source_warehouse_id = sw.id JOIN warehouses dw ON t.destination_warehouse_id = dw.id
         WHERE t.organization_id = $1 ORDER BY t.created_at DESC`,
        [req.session!.organization_id],
      )
    ).rows;
    for (const t of transfers) {
      t.items = (
        await db.query(`SELECT ti.*, i.code as item_code, i.name as item_name FROM stock_transfer_items ti JOIN items i ON ti.item_id = i.id WHERE ti.transfer_id = $1`, [t.id])
      ).rows;
    }
    return ok(req, res, transfers, 200, { total_count: transfers.length });
  });

  app.post('/api/inventory/transfers', authenticate, requirePermission(Permission.INVENTORY_TRANSFER), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const source_warehouse_id = uuid(req.body?.source_warehouse_id, 'source_warehouse_id');
    const destination_warehouse_id = uuid(req.body?.destination_warehouse_id, 'destination_warehouse_id');
    if (source_warehouse_id === destination_warehouse_id) throw validationError('Source and destination warehouses must differ', { field: 'destination_warehouse_id' });
    await assertOrgRef(db, 'warehouses', source_warehouse_id, org, 'source_warehouse_id');
    await assertOrgRef(db, 'warehouses', destination_warehouse_id, org, 'destination_warehouse_id');
    const transfer_date = dateOnly(req.body?.transfer_date, 'transfer_date', { defaultValue: todayIso() });
    const items = arrayOf<any>(req.body?.items, 'items', { min: 1, max: 500 }).map((it, i) => ({
      item_id: uuid(it?.item_id, `items[${i}].item_id`),
      requested_qty: decimal(it?.requested_qty, `items[${i}].requested_qty`, { sign: 'positive' }),
      lot_id: optionalUuid(it?.lot_id, `items[${i}].lot_id`),
    }));
    for (const it of items) await assertOrgRef(db, 'items', it.item_id, org, 'item_id');

    const transfer = await db.transaction(async (tx) => {
      const num = optionalStr(req.body?.transfer_number, 'transfer_number', 64) || (await nextDocumentNumber(tx, org, 'TRF', transfer_date));
      const t = (
        await tx.query(
          `INSERT INTO stock_transfers (transfer_number, source_warehouse_id, destination_warehouse_id, transfer_date, notes, status, organization_id)
           VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6) RETURNING *`,
          [num, source_warehouse_id, destination_warehouse_id, transfer_date, optionalStr(req.body?.notes, 'notes'), org],
        )
      ).rows[0];
      t.items = [];
      for (const it of items) {
        t.items.push(
          (
            await tx.query(
              `INSERT INTO stock_transfer_items (transfer_id, item_id, requested_qty, shipped_qty, received_qty, lot_id) VALUES ($1, $2, $3, 0, 0, $4) RETURNING *`,
              [t.id, it.item_id, it.requested_qty, it.lot_id],
            )
          ).rows[0],
        );
      }
      await audit(req, tx, 'TRANSFER_CREATED', 'STOCK_TRANSFER', t.id, undefined, { transfer_number: num, lines: items.length });
      return t;
    });
    return ok(req, res, transfer, 201);
  });

  app.post('/api/inventory/transfers/:id/ship', authenticate, requirePermission(Permission.INVENTORY_TRANSFER), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const t = await transition(tx, {
        table: 'stock_transfers',
        id: req.params.id,
        organizationId: org,
        from: ['DRAFT'],
        to: 'IN_TRANSIT',
        label: 'Transfer',
        set: { shipped_by: req.session!.user_id, updated_at: new Date().toISOString() },
      });
      const lines = (await tx.query(`SELECT * FROM stock_transfer_items WHERE transfer_id = $1`, [t.id])).rows;
      const itemRows = await lockItems(tx, org, lines.map((l: any) => l.item_id));
      // Stock leaves the source warehouse on shipment (availability enforced).
      for (const l of lines) {
        await postStockMovement(tx, {
          organizationId: org,
          legalEntityId: req.session!.legal_entity_id,
          itemId: l.item_id,
          warehouseId: t.source_warehouse_id,
          movementType: 'TRANSFER_OUT',
          movementDate: toIsoDate(t.transfer_date),
          quantity: new Money(l.requested_qty).negated().toFixed(8),
          unitCost: itemRows.get(l.item_id).unit_cost,
          referenceType: 'STOCK_TRANSFER',
          referenceId: t.id,
          description: `Transfer ${t.transfer_number} shipped`,
        });
      }
      await tx.query(`UPDATE stock_transfer_items SET shipped_qty = requested_qty WHERE transfer_id = $1`, [t.id]);
      await audit(req, tx, 'TRANSFER_SHIPPED', 'STOCK_TRANSFER', t.id, { status: 'DRAFT' }, { status: 'IN_TRANSIT' });
      return { id: t.id, status: 'IN_TRANSIT' };
    });
    return ok(req, res, out);
  });

  app.post('/api/inventory/transfers/:id/receive', authenticate, requirePermission(Permission.INVENTORY_TRANSFER), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const t = await transition(tx, {
        table: 'stock_transfers',
        id: req.params.id,
        organizationId: org,
        from: ['IN_TRANSIT'],
        to: 'COMPLETED',
        label: 'Transfer',
        set: { received_by: req.session!.user_id, updated_at: new Date().toISOString() },
      });
      const lines = (await tx.query(`SELECT * FROM stock_transfer_items WHERE transfer_id = $1`, [t.id])).rows;
      const itemRows = await lockItems(tx, org, lines.map((l: any) => l.item_id));
      for (const l of lines) {
        await postStockMovement(tx, {
          organizationId: org,
          legalEntityId: req.session!.legal_entity_id,
          itemId: l.item_id,
          warehouseId: t.destination_warehouse_id,
          movementType: 'TRANSFER_IN',
          movementDate: toIsoDate(t.transfer_date),
          quantity: new Money(l.shipped_qty).toFixed(8),
          unitCost: itemRows.get(l.item_id).unit_cost,
          referenceType: 'STOCK_TRANSFER',
          referenceId: t.id,
          description: `Transfer ${t.transfer_number} received`,
        });
      }
      await tx.query(`UPDATE stock_transfer_items SET received_qty = shipped_qty WHERE transfer_id = $1`, [t.id]);
      await audit(req, tx, 'TRANSFER_RECEIVED', 'STOCK_TRANSFER', t.id, { status: 'IN_TRANSIT' }, { status: 'COMPLETED' });
      return { id: t.id, status: 'COMPLETED' };
    });
    return ok(req, res, out);
  });

  // ---------- Cycle counts ----------
  app.get('/api/inventory/counts', authenticate, invRead, async (req: Request, res: Response) => {
    const counts = (
      await db.query(
        `SELECT c.*, w.name as warehouse_name FROM inventory_counts c JOIN warehouses w ON c.warehouse_id = w.id
         WHERE c.organization_id = $1 ORDER BY c.created_at DESC`,
        [req.session!.organization_id],
      )
    ).rows;
    for (const c of counts) {
      c.items = (
        await db.query(`SELECT ci.*, i.code as item_code, i.name as item_name FROM inventory_count_items ci JOIN items i ON ci.item_id = i.id WHERE ci.count_id = $1`, [c.id])
      ).rows;
    }
    return ok(req, res, counts, 200, { total_count: counts.length });
  });

  app.post('/api/inventory/counts', authenticate, requirePermission(Permission.INVENTORY_COUNT), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const warehouse_id = uuid(req.body?.warehouse_id, 'warehouse_id');
    const period_id = str(req.body?.period_id, 'period_id', { max: 64 });
    await assertOrgRef(db, 'warehouses', warehouse_id, org, 'warehouse_id');
    const period = await requireOrgRow(db, 'fiscal_periods', period_id, org, 'Fiscal period');
    const count_date = dateOnly(req.body?.count_date, 'count_date', { defaultValue: todayIso() });
    if (count_date < toIsoDate(period.start_date) || count_date > toIsoDate(period.end_date)) {
      throw validationError('count_date must fall within the selected fiscal period', { field: 'count_date' });
    }
    const count = await db.transaction(async (tx) => {
      const num = optionalStr(req.body?.count_number, 'count_number', 64) || (await nextDocumentNumber(tx, org, 'CNT', count_date));
      const c = (
        await tx.query(
          `INSERT INTO inventory_counts (count_number, warehouse_id, period_id, count_date, status, organization_id)
           VALUES ($1, $2, $3, $4, 'PLANNED', $5) RETURNING *`,
          [num, warehouse_id, period_id, count_date, org],
        )
      ).rows[0];
      const items = (await tx.query(`SELECT id, unit_cost FROM items WHERE organization_id = $1 AND item_type = 'INVENTORY' ORDER BY code`, [org])).rows;
      c.items = [];
      for (const it of items) {
        // Snapshot the book quantity of THIS warehouse (previously all warehouses were summed).
        const systemQty = await onHand(tx, org, it.id, warehouse_id);
        c.items.push(
          (
            await tx.query(
              `INSERT INTO inventory_count_items (count_id, item_id, system_qty, counted_qty, variance_qty, unit_cost, variance_value)
               VALUES ($1, $2, $3, $3, 0, $4, 0) RETURNING *`,
              [c.id, it.id, systemQty, it.unit_cost],
            )
          ).rows[0],
        );
      }
      return c;
    });
    return ok(req, res, count, 201);
  });

  app.post('/api/inventory/counts/:id/record', authenticate, requirePermission(Permission.INVENTORY_COUNT), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const counts = arrayOf<any>(req.body?.counts, 'counts', { min: 1, max: 5000 }).map((c, i) => ({
      item_id: uuid(c?.item_id, `counts[${i}].item_id`),
      counted_qty: decimal(c?.counted_qty, `counts[${i}].counted_qty`, { sign: 'nonNegative' }),
    }));
    const out = await db.transaction(async (tx) => {
      const count = await requireOrgRow(tx, 'inventory_counts', req.params.id, org, 'Count sheet', { forUpdate: true });
      if (!['PLANNED', 'COUNTING', 'RECONCILED'].includes(count.status)) {
        throw new ApiError(409, ErrorCode.POSTED_FACT_IMMUTABLE, `Count is ${count.status} and can no longer be recorded`);
      }
      const existing = (await tx.query(`SELECT * FROM inventory_count_items WHERE count_id = $1`, [count.id])).rows;
      const known = new Set(existing.map((r: any) => r.item_id));
      for (const c of counts) if (!known.has(c.item_id)) throw validationError(`Item ${c.item_id} is not on this count sheet`, { field: 'counts' });
      const countMap = new Map(counts.map((c) => [c.item_id, c.counted_qty]));
      const result = InventoryReconciliationEngine.calculateVariances(
        existing.map((row: any) => ({
          item_id: row.item_id,
          system_qty: row.system_qty,
          counted_qty: countMap.get(row.item_id) ?? row.counted_qty,
          unit_cost: row.unit_cost,
        })),
      );
      for (const item of result.items) {
        await tx.query(`UPDATE inventory_count_items SET counted_qty = $1, variance_qty = $2, variance_value = $3 WHERE count_id = $4 AND item_id = $5`, [
          item.counted_qty,
          item.variance_qty,
          item.variance_value,
          count.id,
          item.item_id,
        ]);
      }
      await tx.query(
        `UPDATE inventory_counts SET status = 'RECONCILED', total_variance_value = $1, recorded_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [result.total_variance_value, req.session!.user_id, count.id],
      );
      await audit(req, tx, 'COUNT_RECORDED', 'INVENTORY_COUNT', count.id, { status: count.status }, { status: 'RECONCILED', total_variance_value: result.total_variance_value });
      return { id: count.id, status: 'RECONCILED', total_variance_value: result.total_variance_value };
    });
    return ok(req, res, out);
  });

  app.post('/api/inventory/counts/:id/reconcile-and-post', authenticate, requirePermission(Permission.INVENTORY_ADJUST), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const out = await db.transaction(async (tx) => {
      const count = await requireOrgRow(tx, 'inventory_counts', req.params.id, org, 'Count sheet', { forUpdate: true });
      if (count.status === 'POSTED') throw new ApiError(409, ErrorCode.ALREADY_POSTED, 'Count already posted to GL');
      if (count.status !== 'RECONCILED') throw new ApiError(409, ErrorCode.COUNT_NOT_RECONCILED, 'Record the count before posting adjustments');
      if (count.recorded_by && count.recorded_by === req.session!.user_id) {
        throw sodViolation('Segregation of duties: the count recorder cannot approve the stock adjustment');
      }
      const lines = (await tx.query(`SELECT * FROM inventory_count_items WHERE count_id = $1`, [count.id])).rows;
      const variances = lines.filter((l: any) => !new Money(l.variance_qty).isZero());
      await lockItems(tx, org, variances.map((l: any) => l.item_id));
      const countDate = toIsoDate(count.count_date);
      // Stock facts: previously only a GL voucher was posted and on-hand never changed,
      // so the stock subledger and GL diverged after every count.
      for (const l of variances) {
        await postStockMovement(tx, {
          organizationId: org,
          legalEntityId: req.session!.legal_entity_id,
          itemId: l.item_id,
          warehouseId: count.warehouse_id,
          movementType: 'COUNT_ADJUSTMENT',
          movementDate: countDate,
          quantity: new Money(l.variance_qty).toFixed(8),
          unitCost: l.unit_cost,
          referenceType: 'INVENTORY_COUNT',
          referenceId: count.id,
          description: `Cycle count ${count.count_number} variance`,
          allowNegative: false,
        });
      }
      let journalId: string | null = null;
      const varianceVal = new Money(count.total_variance_value);
      if (!varianceVal.isZero()) {
        const inv = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '113001'`, [org]);
        const adj = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '511002'`, [org]);
        if (!inv.rows[0] || !adj.rows[0]) throw new ApiError(400, ErrorCode.MAPPING_MISSING, 'Required GL accounts (113001 or 511002) not found in COA');
        const draft = InventoryReconciliationEngine.generateAdjustmentJournal({
          inventoryCount: count,
          organizationId: org,
          legalEntityId: req.session!.legal_entity_id,
          inventoryAccountId: inv.rows[0].id,
          adjustmentExpenseAccountId: adj.rows[0].id,
          postingDate: countDate,
          documentDate: countDate,
        });
        const posted = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org,
          legalEntityId: req.session!.legal_entity_id,
          userId: req.session!.user_id,
          postingDate: countDate,
          purpose: AccountingPurpose.INVENTORY_ADJUSTMENT,
          description: draft.description,
          sourceType: 'INVENTORY_COUNT',
          sourceId: count.id,
          sourceKey: `INVENTORY_COUNT:${count.id}`,
          numberPrefix: 'JV-ADJ',
          correlationId: req.correlationId,
          lines: draft.lines.map((l: any) => ({ account_id: l.account_id, debit: l.base_debit, credit: l.base_credit, description: l.description })),
        });
        journalId = posted?.journalId ?? null;
      }
      await transition(tx, {
        table: 'inventory_counts',
        id: count.id,
        organizationId: org,
        from: ['RECONCILED'],
        to: 'POSTED',
        label: 'Count',
        set: { journal_id: journalId, posted_by: req.session!.user_id, updated_at: new Date().toISOString() },
      });
      await audit(req, tx, 'COUNT_POSTED', 'INVENTORY_COUNT', count.id, { status: 'RECONCILED' }, { status: 'POSTED', journal_id: journalId });
      return { id: count.id, status: 'POSTED', journal_id: journalId, total_variance_value: count.total_variance_value };
    });
    return ok(req, res, out);
  });
}
