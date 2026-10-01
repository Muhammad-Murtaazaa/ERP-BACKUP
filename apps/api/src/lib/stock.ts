import crypto from 'node:crypto';
import { DbClient } from '@omnysync/platform';
import { Money } from '@omnysync/financial-engine';
import { ErrorCode } from '@omnysync/contracts';
import { ApiError, validationError } from './errors.js';
import { toIsoDate } from './validate.js';

/**
 * Stock ledger service. Every quantity change goes through here so that:
 *  - item rows are locked (FOR UPDATE, deterministic order) before availability is
 *    checked, serialising concurrent issues of the same item (no oversell race);
 *  - issues never drive a warehouse negative unless explicitly allowed;
 *  - movements are append-only facts (DB trigger in migration 011).
 * Valuation uses items.unit_cost. With the org setting inventory.costing_method = MOVING_AVERAGE,
 * movements flagged `revalue` (purchase receipts) re-compute unit_cost as the weighted average of
 * on-hand value and the receipt, so later issues are costed at the moving average (ADR-002,
 * ADR-016). STANDARD (default) leaves unit_cost untouched. With FIFO, inbound movements open cost
 * layers and outbound movements consume the oldest layers first; the movement is valued at the
 * consumed layers (returned as unit_cost / total_value so callers post GL at the same value).
 * Stock that pre-dates the switch to FIFO has no layers and is valued at the caller's unit cost.
 * Transfers are valuation-neutral and leave the layers untouched.
 */

const LAYER_NEUTRAL = new Set(['TRANSFER_OUT', 'TRANSFER_IN']);

export interface StockMoveResult {
  id: string;
  /** Signed movement value (negative for issues). */
  total_value: string;
  /** Unit cost the movement was valued at (FIFO: weighted cost of the consumed layers). */
  unit_cost: string;
  on_hand_after: string;
}

/** Pure FIFO consumption: take qty from layers oldest first; any shortfall is valued at fallbackCost. */
export function fifoConsume(layers: { id: string; qty_remaining: string; unit_cost: string }[], qty: string, fallbackCost: string) {
  let need = new Money(qty);
  let value = Money.zero();
  const takes: { id: string | null; quantity: string; unit_cost: string }[] = [];
  for (const l of layers) {
    if (!need.isPositive()) break;
    const avail = new Money(l.qty_remaining);
    if (!avail.isPositive()) continue;
    const take = avail.lt(need) ? avail : need;
    takes.push({ id: l.id, quantity: take.toFixed(8), unit_cost: new Money(l.unit_cost).toFixed(8) });
    value = value.add(take.mul(l.unit_cost));
    need = need.sub(take);
  }
  if (need.isPositive()) {
    takes.push({ id: null, quantity: need.toFixed(8), unit_cost: new Money(fallbackCost).toFixed(8) });
    value = value.add(need.mul(fallbackCost));
  }
  const unit = new Money(qty).isZero() ? new Money(fallbackCost) : value.div(qty).round(8);
  return { value: value.round(8).toFixed(8), unit_cost: unit.toFixed(8), takes };
}

export interface StockMoveInput {
  organizationId: string;
  legalEntityId: string;
  itemId: string;
  warehouseId: string | null;
  movementType: string;
  movementDate: string;
  /** Signed quantity: positive = into stock, negative = out of stock. */
  quantity: string;
  unitCost: string;
  referenceType: string;
  referenceId: string | null;
  description: string;
  allowNegative?: boolean;
  /** Purchase receipts: re-compute the moving-average cost when that method is configured. */
  revalue?: boolean;
}

/** Weighted-average cost after receiving qtyIn at receiptCost. Non-positive stock resets to the receipt cost. */
export function movingAverage(qtyBefore: string, oldCost: string, qtyIn: string, receiptCost: string): string {
  const qb = new Money(qtyBefore);
  if (!qb.isPositive()) return new Money(receiptCost).toFixed(8);
  const total = qb.add(qtyIn);
  return qb.mul(oldCost).add(new Money(qtyIn).mul(receiptCost)).div(total).round(8).toFixed(8);
}

export async function costingMethod(q: DbClient, organizationId: string): Promise<string> {
  const r = await q.query(`SELECT value FROM org_settings WHERE organization_id = $1 AND setting_key = 'inventory.costing_method'`, [organizationId]);
  const v = r.rows[0]?.value;
  return typeof v === 'string' ? v : 'STANDARD';
}

export async function lockItems(q: DbClient, organizationId: string, itemIds: string[]): Promise<Map<string, any>> {
  const unique = [...new Set(itemIds)].sort();
  const out = new Map<string, any>();
  for (const id of unique) {
    const r = await q.query(`SELECT * FROM items WHERE id::text = $1 AND organization_id = $2 FOR UPDATE`, [id, organizationId]);
    if (r.rows.length === 0) throw validationError(`Item ${id} not found`, { field: 'item_id' });
    out.set(id, r.rows[0]);
  }
  return out;
}

export async function defaultWarehouseId(q: DbClient, organizationId: string): Promise<string | null> {
  const r = await q.query(
    `SELECT id FROM warehouses WHERE organization_id = $1 AND is_active = true ORDER BY is_default DESC, code ASC LIMIT 1`,
    [organizationId],
  );
  return r.rows[0]?.id ?? null;
}

/** On-hand quantity for an item, optionally within one warehouse. */
export async function onHand(q: DbClient, organizationId: string, itemId: string, warehouseId?: string | null): Promise<string> {
  if (!warehouseId) {
    const r = await q.query(`SELECT COALESCE(SUM(quantity), 0)::text AS q FROM stock_movements WHERE organization_id = $1 AND item_id = $2`, [
      organizationId,
      itemId,
    ]);
    return new Money(r.rows[0].q).toFixed(8);
  }
  const r = await q.query(
    `SELECT COALESCE(SUM(sm.quantity), 0)::text AS q
     FROM stock_movements sm
     WHERE sm.organization_id = $1 AND sm.item_id = $2
       AND (sm.location_id = $3 OR (sm.location_id IS NULL AND EXISTS (
            SELECT 1 FROM warehouses w WHERE w.id = $3 AND w.is_default = true)))`,
    [organizationId, itemId, warehouseId],
  );
  return new Money(r.rows[0].q).toFixed(8);
}

export async function postStockMovement(q: DbClient, input: StockMoveInput): Promise<StockMoveResult> {
  const qty = new Money(input.quantity);
  if (qty.isZero()) throw validationError('Stock movement quantity cannot be zero');
  const before = await onHand(q, input.organizationId, input.itemId, input.warehouseId);
  const after = new Money(before).add(qty);
  if (qty.isNegative() && after.isNegative() && !input.allowNegative) {
    throw new ApiError(409, ErrorCode.INSUFFICIENT_STOCK, `Insufficient stock: on hand ${new Money(before).format(4)}, requested ${qty.abs().format(4)}`, {
      item_id: input.itemId,
      warehouse_id: input.warehouseId,
      on_hand: before,
      requested: qty.abs().toFixed(8),
    });
  }
  const id = crypto.randomUUID();
  const method = await costingMethod(q, input.organizationId);
  const fifo = method === 'FIFO' && !LAYER_NEUTRAL.has(input.movementType);
  let unitCost = new Money(input.unitCost).toFixed(8);
  let totalValue = qty.mul(input.unitCost).toFixed(8);
  let takes: { id: string | null; quantity: string; unit_cost: string }[] = [];
  if (fifo && qty.isNegative()) {
    const layers = (
      await q.query(
        `SELECT id, qty_remaining::text, unit_cost::text FROM stock_cost_layers WHERE organization_id = $1 AND item_id = $2 AND qty_remaining > 0
         ORDER BY received_date, seq FOR UPDATE`,
        [input.organizationId, input.itemId],
      )
    ).rows;
    const r = fifoConsume(layers, qty.abs().toFixed(8), input.unitCost);
    unitCost = r.unit_cost;
    totalValue = new Money(r.value).negated().toFixed(8);
    takes = r.takes;
  }
  await q.query(
    `INSERT INTO stock_movements (
      id, organization_id, legal_entity_id, item_id, warehouse_id, location_id, movement_type, movement_date,
      quantity, unit_cost, total_value, reference_type, reference_id, description
    ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      input.organizationId,
      input.legalEntityId,
      input.itemId,
      input.warehouseId,
      input.movementType,
      input.movementDate,
      qty.toFixed(8),
      unitCost,
      totalValue,
      input.referenceType,
      input.referenceId,
      input.description,
    ],
  );
  if (fifo && qty.isPositive()) {
    await q.query(
      `INSERT INTO stock_cost_layers (organization_id, item_id, stock_movement_id, received_date, qty_original, qty_remaining, unit_cost) VALUES ($1,$2,$3,$4,$5,$5,$6)`,
      [input.organizationId, input.itemId, id, input.movementDate, qty.toFixed(8), unitCost],
    );
  }
  for (const t of takes) {
    if (t.id) await q.query(`UPDATE stock_cost_layers SET qty_remaining = qty_remaining - $1 WHERE id = $2`, [t.quantity, t.id]);
    await q.query(`INSERT INTO stock_layer_consumptions (organization_id, layer_id, stock_movement_id, quantity, unit_cost) VALUES ($1,$2,$3,$4,$5)`, [
      input.organizationId, t.id, id, t.quantity, t.unit_cost,
    ]);
  }
  if (input.revalue && qty.isPositive() && method === 'MOVING_AVERAGE') {
    const item = (await q.query(`SELECT unit_cost::text AS c FROM items WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [input.itemId, input.organizationId])).rows[0];
    const qtyBefore = new Money(await onHand(q, input.organizationId, input.itemId)).sub(qty).toFixed(8); // org-wide, excluding this receipt
    const newCost = movingAverage(qtyBefore, item.c, qty.toFixed(8), input.unitCost);
    if (!new Money(newCost).sub(item.c).isZero()) {
      await q.query(`UPDATE items SET unit_cost = $1, updated_at = NOW() WHERE id = $2`, [newCost, input.itemId]);
    }
    await q.query(
      `INSERT INTO item_cost_changes (organization_id, item_id, stock_movement_id, method, qty_before, qty_in, old_cost, receipt_cost, new_cost) VALUES ($1,$2,$3,'MOVING_AVERAGE',$4,$5,$6,$7,$8)`,
      [input.organizationId, input.itemId, id, qtyBefore, qty.toFixed(8), item.c, new Money(input.unitCost).toFixed(8), newCost],
    );
  }
  return { id, total_value: totalValue, unit_cost: unitCost, on_hand_after: after.toFixed(8) };
}

/**
 * Aligns FIFO layers with on-hand stock (org-wide, per item) — idempotent. Missing quantity opens an
 * OPENING layer at the item's current unit cost, dated at the item's first movement / before its oldest
 * open layer (so it is consumed first); surplus layer quantity left over from issues made under another costing method is trimmed
 * oldest-first. Valuation-neutral: no stock movement or journal is created.
 */
export async function reconcileFifoLayers(q: DbClient, organizationId: string, asOf: string) {
  const rows = (
    await q.query(
      `SELECT i.id, i.code, COALESCE(i.unit_cost, 0)::text AS unit_cost,
              COALESCE((SELECT SUM(quantity) FROM stock_movements sm WHERE sm.organization_id = $1 AND sm.item_id = i.id), 0)::text AS on_hand,
              COALESCE((SELECT SUM(qty_remaining) FROM stock_cost_layers l WHERE l.organization_id = $1 AND l.item_id = i.id), 0)::text AS layered,
              (SELECT MIN(received_date) FROM stock_cost_layers l WHERE l.organization_id = $1 AND l.item_id = i.id AND l.qty_remaining > 0) AS oldest,
              (SELECT MIN(movement_date) FROM stock_movements sm WHERE sm.organization_id = $1 AND sm.item_id = i.id) AS first_movement
       FROM items i WHERE i.organization_id = $1
         AND (EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.organization_id = $1 AND sm.item_id = i.id) OR EXISTS (SELECT 1 FROM stock_cost_layers l WHERE l.organization_id = $1 AND l.item_id = i.id AND l.qty_remaining > 0))
       ORDER BY i.code FOR UPDATE OF i`,
      [organizationId],
    )
  ).rows;
  const opened: { item: string; quantity: string; unit_cost: string }[] = [];
  const trimmed: { item: string; quantity: string }[] = [];
  for (const r of rows) {
    const onHandQty = Money.max(new Money(r.on_hand), Money.zero());
    const gap = onHandQty.sub(r.layered);
    if (gap.isPositive()) {
      // Opening stock pre-dates everything still layered: date it at the item's first movement (or the day before its oldest open layer).
      const cands = [asOf];
      if (r.first_movement) cands.push(toIsoDate(r.first_movement));
      if (r.oldest) cands.push(new Date(Date.parse(toIsoDate(r.oldest)) - 86400000).toISOString().slice(0, 10));
      const d = cands.sort()[0];
      await q.query(
        `INSERT INTO stock_cost_layers (organization_id, item_id, stock_movement_id, received_date, qty_original, qty_remaining, unit_cost, layer_source) VALUES ($1,$2,$3,$4,$5,$5,$6,'OPENING')`,
        [organizationId, r.id, crypto.randomUUID(), d, gap.toFixed(8), new Money(r.unit_cost).toFixed(8)],
      );
      opened.push({ item: r.code, quantity: gap.toFixed(4), unit_cost: new Money(r.unit_cost).toFixed(4) });
    } else if (gap.isNegative()) {
      let excess = gap.abs();
      const layers = (await q.query(`SELECT id, qty_remaining::text FROM stock_cost_layers WHERE organization_id = $1 AND item_id = $2 AND qty_remaining > 0 ORDER BY received_date, seq FOR UPDATE`, [organizationId, r.id])).rows;
      for (const l of layers) {
        if (!excess.isPositive()) break;
        const take = Money.min(excess, new Money(l.qty_remaining));
        await q.query(`UPDATE stock_cost_layers SET qty_remaining = qty_remaining - $1 WHERE id = $2`, [take.toFixed(8), l.id]);
        excess = excess.sub(take);
      }
      trimmed.push({ item: r.code, quantity: gap.abs().toFixed(4) });
    }
  }
  return { opened, trimmed };
}
