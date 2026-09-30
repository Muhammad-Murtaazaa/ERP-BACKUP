import crypto from 'node:crypto';
import { DbClient } from '@omnysync/platform';
import { Money } from '@omnysync/financial-engine';
import { ErrorCode } from '@omnysync/contracts';
import { ApiError, validationError } from './errors.js';

/**
 * Stock ledger service. Every quantity change goes through here so that:
 *  - item rows are locked (FOR UPDATE, deterministic order) before availability is
 *    checked, serialising concurrent issues of the same item (no oversell race);
 *  - issues never drive a warehouse negative unless explicitly allowed;
 *  - movements are append-only facts (DB trigger in migration 011).
 * Valuation uses the item standard cost (items.unit_cost) — documented in
 * decisions/ADR-0101-stock-ledger-and-costing.md.
 */

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

export async function postStockMovement(q: DbClient, input: StockMoveInput): Promise<{ id: string; total_value: string; on_hand_after: string }> {
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
  const totalValue = qty.mul(input.unitCost).toFixed(8);
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
      new Money(input.unitCost).toFixed(8),
      totalValue,
      input.referenceType,
      input.referenceId,
      input.description,
    ],
  );
  return { id, total_value: totalValue, on_hand_after: after.toFixed(8) };
}
