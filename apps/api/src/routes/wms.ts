/**
 * WMS: bin stock (sub-ledger of warehouse stock), directed putaway, bin moves and pick lists
 * generated from confirmed sales orders. Bin quantities can never exceed what the stock ledger
 * holds in that warehouse, never go negative (DB CHECK + row locks), and a sales order has at
 * most one live pick list (partial unique index), so a double-click cannot double-allocate.
 */
import type { Express, Request, Response } from 'express';
import { Permission, ErrorCode } from '@omnysync/contracts';
import { Money } from '@omnysync/financial-engine';
import { db, authenticate, requireAnyPermission, requirePermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, notFound, validationError } from '../lib/errors.js';
import { audit, defineResource, emit, unitOfWork, loadRow } from '../lib/resource.js';
import { decimal, str } from '../lib/validate.js';
import { onHand, defaultWarehouseId } from '../lib/stock.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { requireModule } from '../lib/modules.js';
import { allocatePick } from '../domain/wms.js';

const WMS_READ = [Permission.WMS_MANAGE, Permission.WMS_PICK, Permission.WAREHOUSE_MANAGE, Permission.INVENTORY_MANAGE];

async function loadBin(q: any, org: string, binId: unknown) {
  if (typeof binId !== 'string') throw validationError('bin_id is required', { field: 'bin_id' });
  const r = await q.query(`SELECT b.*, w.organization_id FROM warehouse_bins b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.id::text = $1 AND w.organization_id = $2 FOR UPDATE OF b`, [binId, org]);
  if (!r.rows[0]) throw new ApiError(400, ErrorCode.FORBIDDEN_SCOPE, 'Bin does not exist in this organization', { field: 'bin_id' });
  if (!r.rows[0].is_active) throw validationError('Bin is inactive', { field: 'bin_id' });
  return r.rows[0];
}

async function binnedQty(q: any, org: string, warehouseId: string, itemId: string) {
  const r = await q.query(`SELECT COALESCE(SUM(bs.quantity),0)::text AS q FROM bin_stock bs JOIN warehouse_bins b ON b.id = bs.bin_id WHERE bs.organization_id = $1 AND b.warehouse_id = $2 AND bs.item_id = $3`, [org, warehouseId, itemId]);
  return new Money(r.rows[0].q);
}

async function addBinQty(q: any, org: string, binId: string, itemId: string, delta: Money, type: string, user: string, refType?: string, refId?: string) {
  if (delta.isNegative()) {
    const cur = await q.query(`SELECT quantity FROM bin_stock WHERE bin_id = $1 AND item_id = $2 FOR UPDATE`, [binId, itemId]);
    const have = new Money(cur.rows[0]?.quantity ?? '0');
    if (have.add(delta).isNegative()) throw new ApiError(409, ErrorCode.INSUFFICIENT_STOCK, `Bin holds ${have.format(4)}, cannot remove ${delta.abs().format(4)}`);
  }
  if (delta.isNegative()) {
    // (The proposed INSERT row would fail the CHECK before ON CONFLICT, so decrements are plain UPDATEs.)
    await q.query(`UPDATE bin_stock SET quantity = quantity + $3, updated_at = NOW() WHERE bin_id = $1 AND item_id = $2`, [binId, itemId, delta.toFixed(8)]);
  } else {
    await q.query(
      `INSERT INTO bin_stock (organization_id, bin_id, item_id, quantity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (bin_id, item_id) DO UPDATE SET quantity = bin_stock.quantity + EXCLUDED.quantity, updated_at = NOW()`,
      [org, binId, itemId, delta.toFixed(8)],
    );
  }
  await q.query(`INSERT INTO bin_movements (organization_id, bin_id, item_id, quantity, movement_type, reference_type, reference_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    org, binId, itemId, delta.toFixed(8), type, refType ?? null, refId ?? null, user,
  ]);
}

export function registerWmsRoutes(app: Express): void {
  app.get('/api/wms/bins', authenticate, requireAnyPermission(...WMS_READ), async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT b.id, b.bin_code, b.bin_type, b.capacity_qty, b.is_active, w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              COALESCE((SELECT SUM(quantity) FROM bin_stock bs WHERE bs.bin_id = b.id),0)::text AS total_qty,
              (SELECT COUNT(*)::int FROM bin_stock bs WHERE bs.bin_id = b.id AND bs.quantity > 0) AS sku_count
       FROM warehouse_bins b JOIN warehouses w ON w.id = b.warehouse_id WHERE w.organization_id = $1 ORDER BY w.code, b.bin_code`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows.map((x) => ({ ...x, code: x.bin_code, status: x.is_active ? 'ACTIVE' : 'INACTIVE' })));
  });

  app.post('/api/wms/bins', authenticate, requirePermission(Permission.WMS_MANAGE), requireModule('WMS', 'create'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const wh = await loadRow(ctx.tx, 'warehouses', req.body?.warehouse_id, ctx.org, 'Warehouse');
      const code = str(req.body?.bin_code, 'bin_code', { max: 32, pattern: /^[A-Z0-9-]+$/ });
      const type = ['PICK', 'BULK', 'STAGING', 'QUARANTINE'].includes(req.body?.bin_type) ? req.body.bin_type : 'PICK';
      const cap = req.body?.capacity_qty ? decimal(req.body.capacity_qty, 'capacity_qty', { sign: 'positive' }) : null;
      const r = await ctx.tx.query(`INSERT INTO warehouse_bins (warehouse_id, bin_code, bin_type, capacity_qty) VALUES ($1,$2,$3,$4) RETURNING *`, [wh.id, code, type, cap]);
      await audit(ctx, 'BIN_CREATED', 'BIN', r.rows[0].id, undefined, { warehouse: wh.code, code, type });
      return r.rows[0];
    });
    return ok(req, res, out, 201);
  });

  app.get('/api/wms/bin-stock', authenticate, requireAnyPermission(...WMS_READ), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const r = await db.query(
      `SELECT bs.bin_id || ':' || bs.item_id AS id, bs.quantity, b.bin_code, b.bin_type, w.code AS warehouse_code, i.code AS item_code, i.name AS item_name, bs.updated_at
       FROM bin_stock bs JOIN warehouse_bins b ON b.id = bs.bin_id JOIN warehouses w ON w.id = b.warehouse_id JOIN items i ON i.id = bs.item_id
       WHERE bs.organization_id = $1 AND bs.quantity > 0 ORDER BY w.code, b.bin_code, i.code`,
      [org],
    );
    return ok(req, res, r.rows);
  });

  /** Unbinned = warehouse on-hand (stock ledger) minus quantity already put away to bins. */
  app.get('/api/wms/unbinned', authenticate, requireAnyPermission(...WMS_READ), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const whs = (await db.query(`SELECT id, code FROM warehouses WHERE organization_id = $1 AND is_active`, [org])).rows;
    const items = (await db.query(`SELECT id, code, name FROM items WHERE organization_id = $1 AND item_type = 'INVENTORY' ORDER BY code`, [org])).rows;
    const out: any[] = [];
    for (const w of whs)
      for (const it of items) {
        const oh = new Money(await onHand(db, org, it.id, w.id));
        if (!oh.isPositive()) continue;
        const binned = await binnedQty(db, org, w.id, it.id);
        const un = oh.sub(binned);
        if (un.isPositive()) out.push({ id: `${w.id}:${it.id}`, warehouse_id: w.id, warehouse_code: w.code, item_id: it.id, item_code: it.code, item_name: it.name, on_hand: oh.toFixed(4), binned: binned.toFixed(4), unbinned: un.toFixed(4) });
      }
    return ok(req, res, out);
  });

  app.post('/api/wms/putaway', authenticate, requireAnyPermission(Permission.WMS_MANAGE, Permission.WMS_PICK), requireModule('WMS'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const bin = await loadBin(ctx.tx, ctx.org, req.body?.bin_id);
      const item = await loadRow(ctx.tx, 'items', req.body?.item_id, ctx.org, 'Item', true);
      const qty = new Money(decimal(req.body?.quantity, 'quantity', { sign: 'positive', scale: 4 }));
      if (bin.bin_type === 'QUARANTINE' && req.body?.quarantine !== true) throw validationError('Quarantine bins need an explicit quarantine putaway', { field: 'bin_id' });
      const oh = new Money(await onHand(ctx.tx, ctx.org, item.id, bin.warehouse_id));
      const binned = await binnedQty(ctx.tx, ctx.org, bin.warehouse_id, item.id);
      if (binned.add(qty).gt(oh)) throw new ApiError(409, ErrorCode.INSUFFICIENT_STOCK, `Only ${oh.sub(binned).format(4)} of ${item.code} is unbinned in this warehouse`, { field: 'quantity' });
      if (bin.capacity_qty) {
        const inBin = new Money((await ctx.tx.query(`SELECT COALESCE(SUM(quantity),0)::text q FROM bin_stock WHERE bin_id = $1`, [bin.id])).rows[0].q);
        if (inBin.add(qty).gt(bin.capacity_qty)) throw new ApiError(409, ErrorCode.CAPACITY_CONFLICT, `Bin ${bin.bin_code} capacity ${new Money(bin.capacity_qty).format(0)} would be exceeded`, { field: 'quantity' });
      }
      await addBinQty(ctx.tx, ctx.org, bin.id, item.id, qty, 'PUTAWAY', ctx.user);
      await audit(ctx, 'BIN_PUTAWAY', 'BIN', bin.id, undefined, { item: item.code, quantity: qty.toFixed(4) });
      await emit(ctx, 'WMS_PUTAWAY', { bin_id: bin.id, item_id: item.id, quantity: qty.toFixed(4) });
      return { bin_code: bin.bin_code, item_code: item.code, quantity: qty.toFixed(4) };
    });
    return ok(req, res, out);
  });

  app.post('/api/wms/move', authenticate, requireAnyPermission(Permission.WMS_MANAGE, Permission.WMS_PICK), requireModule('WMS'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const from = await loadBin(ctx.tx, ctx.org, req.body?.from_bin_id);
      const to = await loadBin(ctx.tx, ctx.org, req.body?.to_bin_id);
      if (from.id === to.id) throw validationError('Source and destination bins must differ', { field: 'to_bin_id' });
      if (from.warehouse_id !== to.warehouse_id) throw validationError('Use a stock transfer to move between warehouses', { field: 'to_bin_id' });
      const item = await loadRow(ctx.tx, 'items', req.body?.item_id, ctx.org, 'Item');
      const qty = new Money(decimal(req.body?.quantity, 'quantity', { sign: 'positive', scale: 4 }));
      await addBinQty(ctx.tx, ctx.org, from.id, item.id, qty.negated(), 'MOVE_OUT', ctx.user);
      await addBinQty(ctx.tx, ctx.org, to.id, item.id, qty, 'MOVE_IN', ctx.user);
      await audit(ctx, 'BIN_MOVE', 'BIN', from.id, undefined, { to: to.bin_code, item: item.code, quantity: qty.toFixed(4) });
      return { from: from.bin_code, to: to.bin_code, quantity: qty.toFixed(4) };
    });
    return ok(req, res, out);
  });

  defineResource(app, {
    path: '/api/wms/pick-lists',
    table: 'pick_lists',
    label: 'Pick list',
    event: 'PICK_LIST',
    module: 'WMS',
    view: WMS_READ,
    create: false,
    update: false,
    fields: {},
    select: `t.*, so.order_number, w.code AS warehouse_code, (SELECT COUNT(*)::int FROM pick_list_lines l WHERE l.pick_list_id = t.id) AS line_count`,
    joins: `JOIN sales_orders so ON so.id = t.sales_order_id JOIN warehouses w ON w.id = t.warehouse_id`,
    search: ['number', 'so.order_number'],
    detail: async (q, row) => ({
      lines: (
        await q.query(
          `SELECT l.*, i.code AS item_code, i.name AS item_name, b.bin_code FROM pick_list_lines l JOIN items i ON i.id = l.item_id LEFT JOIN warehouse_bins b ON b.id = l.bin_id WHERE l.pick_list_id = $1 ORDER BY i.code, b.bin_code`,
          [row.id],
        )
      ).rows,
    }),
    commands: {
      start: { from: ['OPEN'], to: 'PICKING', permission: [Permission.WMS_PICK, Permission.WMS_MANAGE] },
      complete: {
        from: ['PICKING'],
        to: 'PICKED',
        permission: [Permission.WMS_PICK, Permission.WMS_MANAGE],
        run: async (ctx, row) => {
          const open = (await ctx.tx.query(`SELECT COUNT(*)::int n FROM pick_list_lines WHERE pick_list_id = $1 AND bin_id IS NOT NULL AND qty_picked < qty_requested`, [row.id])).rows[0].n;
          if (open > 0) throw new ApiError(409, ErrorCode.INVALID_STATE, `${open} line(s) are not fully picked`);
        },
      },
      cancel: { from: ['OPEN', 'PICKING'], to: 'CANCELLED', permission: Permission.WMS_MANAGE },
    },
  });

  app.post('/api/wms/pick-lists/generate', authenticate, requireAnyPermission(Permission.WMS_MANAGE, Permission.WMS_PICK), requireModule('WMS', 'create'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const so = await loadRow(ctx.tx, 'sales_orders', req.body?.sales_order_id, ctx.org, 'Sales order', true);
      if (so.status !== 'CONFIRMED') throw new ApiError(409, ErrorCode.INVALID_STATE, `Sales order ${so.order_number} is ${so.status}; only CONFIRMED orders can be picked`);
      const existing = await ctx.tx.query(`SELECT number FROM pick_lists WHERE sales_order_id = $1 AND status <> 'CANCELLED'`, [so.id]);
      if (existing.rows[0]) throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `Pick list ${existing.rows[0].number} already exists for ${so.order_number}`);
      const whId = (typeof req.body?.warehouse_id === 'string' && (await loadRow(ctx.tx, 'warehouses', req.body.warehouse_id, ctx.org, 'Warehouse')).id) || so.warehouse_id || (await defaultWarehouseId(ctx.tx, ctx.org));
      if (!whId) throw validationError('No warehouse available', { field: 'warehouse_id' });
      const lines = (await ctx.tx.query(`SELECT sol.item_id, SUM(sol.quantity - sol.fulfilled_quantity)::text AS qty FROM sales_order_lines sol JOIN items i ON i.id = sol.item_id WHERE sol.sales_order_id = $1 AND i.item_type = 'INVENTORY' GROUP BY sol.item_id`, [so.id])).rows;
      if (!lines.length) throw validationError('Sales order has no stock lines to pick');
      const number = await nextDocumentNumber(ctx.tx, ctx.org, 'PICK');
      const pl = (await ctx.tx.query(`INSERT INTO pick_lists (organization_id, legal_entity_id, number, sales_order_id, warehouse_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [ctx.org, ctx.le, number, so.id, whId, ctx.user])).rows[0];
      let shortage = false;
      for (const l of lines) {
        if (!new Money(l.qty).isPositive()) continue;
        const bins = (await ctx.tx.query(`SELECT bs.bin_id, b.bin_code, b.bin_type, bs.quantity::text AS quantity FROM bin_stock bs JOIN warehouse_bins b ON b.id = bs.bin_id WHERE b.warehouse_id = $1 AND bs.item_id = $2 AND b.is_active`, [whId, l.item_id])).rows;
        const alloc = allocatePick(l.qty, bins);
        if (alloc.shortage !== '0') shortage = true;
        for (const a of alloc.allocations) await ctx.tx.query(`INSERT INTO pick_list_lines (pick_list_id, item_id, bin_id, qty_requested) VALUES ($1,$2,$3,$4)`, [pl.id, l.item_id, a.bin_id, a.quantity]);
      }
      await ctx.tx.query(`UPDATE pick_lists SET shortage = $2 WHERE id = $1`, [pl.id, shortage]);
      await audit(ctx, 'PICK_LIST_GENERATED', 'PICK_LIST', pl.id, undefined, { number, sales_order: so.order_number, shortage });
      await emit(ctx, 'PICK_LIST_GENERATED', { id: pl.id, number, sales_order_id: so.id, shortage });
      return { ...pl, shortage };
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/wms/pick-lists/:id/lines/:lineId/confirm', authenticate, requireAnyPermission(Permission.WMS_PICK, Permission.WMS_MANAGE), requireModule('WMS'), async (req: Request, res: Response) => {
    const out = await unitOfWork(req, async (ctx) => {
      const pl = await loadRow(ctx.tx, 'pick_lists', req.params.id, ctx.org, 'Pick list', true);
      if (pl.status !== 'PICKING') throw new ApiError(409, ErrorCode.INVALID_STATE, `Start the pick list first (status ${pl.status})`);
      const line = (await ctx.tx.query(`SELECT * FROM pick_list_lines WHERE id::text = $1 AND pick_list_id = $2 FOR UPDATE`, [req.params.lineId, pl.id])).rows[0];
      if (!line) throw notFound('Pick line');
      if (!line.bin_id) throw new ApiError(409, ErrorCode.INSUFFICIENT_STOCK, 'Shortage line has no bin allocation; replenish and regenerate');
      const qty = new Money(decimal(req.body?.quantity, 'quantity', { sign: 'positive', scale: 4 }));
      const remaining = new Money(line.qty_requested).sub(line.qty_picked);
      if (qty.gt(remaining)) throw validationError(`Only ${remaining.format(4)} remains to pick on this line`, { field: 'quantity' });
      await addBinQty(ctx.tx, ctx.org, line.bin_id, line.item_id, qty.negated(), 'PICK', ctx.user, 'PICK_LIST', pl.id);
      await ctx.tx.query(`UPDATE pick_list_lines SET qty_picked = qty_picked + $2 WHERE id = $1`, [line.id, qty.toFixed(8)]);
      await audit(ctx, 'PICK_CONFIRMED', 'PICK_LIST', pl.id, undefined, { line: line.id, quantity: qty.toFixed(4) });
      return { line_id: line.id, picked: new Money(line.qty_picked).add(qty).toFixed(4), requested: new Money(line.qty_requested).toFixed(4) };
    });
    return ok(req, res, out);
  });
}
