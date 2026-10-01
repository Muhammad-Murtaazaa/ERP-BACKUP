# ADR-016 — Optional moving-average inventory costing
Status: accepted • 1 October 2026 • extends ADR-002

## Decision
The org setting `inventory.costing_method` selects `STANDARD` (default, unchanged behaviour) or `MOVING_AVERAGE`.

Under moving average, every purchase-order receipt re-computes `items.unit_cost` inside the receipt transaction, using the item row lock:

`(on-hand qty before × current cost + receipt qty × PO price) ÷ (on-hand qty before + receipt qty)`

- On-hand is org-wide.
- Zero or negative on-hand resets the cost to the receipt price.
- Each change is written to `item_cost_changes`: before qty, old cost, receipt cost, new cost and movement id.

All issues already value at `items.unit_cost`, so they now cost at the current average. This covers sales shipments and COGS, service parts, POS, transfers and counts.

## Consequences
- The inventory GL tracks receipts at the actual price and issues at the average, so the purchase-price variance drift seen under standard cost no longer builds up.
- **FIFO is not implemented.** It needs cost layers and layer consumption on every issue.
- Moving average re-costs only on PO receipts. Returns and transfers move at the current average. Historic movements are not revalued when the method is switched.

## Addendum (round 2, later): FIFO implemented

`inventory.costing_method` now also accepts `FIFO` (migration 035):

- Every inbound movement opens a row in `stock_cost_layers`. Outbound movements lock the open layers (`FOR UPDATE`, ordered by receipt date then sequence) and consume them oldest first. Each take is recorded in `stock_layer_consumptions`.
- `postStockMovement` returns the `unit_cost` / `total_value` it actually used. Sales fulfilment (COGS), POS sale (the line keeps the issued cost, so returns re-stock at it), SRV parts issue, manufacturing material issue, maintenance spare parts and QM scrap all post GL at that value, so the stock subledger and GL agree.
- Transfers are valuation-neutral and don't touch layers. Layers are org-wide, not per warehouse.
- Stock received before the switch to FIFO has no layers. Any shortfall is valued at the caller's unit cost (the item cost), and the consumption is recorded with `layer_id = NULL`.
- Known gaps:
  - Cycle-count adjustments still post their GL from the count sheet value (item cost); their movements consume layers by quantity.
  - There is no opening-layer migration tool and no FIFO cost on landed-cost or price-variance adjustments.

## Addendum 2 (round 2, final): opening layers, per-warehouse layers, count valuation

These close the FIFO gaps listed above (migrations 043, 046):

- **Opening layers.** Switching `inventory.costing_method` to FIFO now calls `reconcileFifoLayers`, which aligns open layers with on-hand stock for each item:
  - Missing quantity gets an `OPENING` layer at the item's current cost. The layer is dated at the item's first movement, or the day before its oldest open layer, so it is consumed first.
  - Surplus layer quantity, left over from issues made under another method, is trimmed oldest-first.
  - It is valuation-neutral: no movement and no journal are created.
  - The same tool is available as `POST /api/inventory/fifo/reconcile-layers` (FIFO only, otherwise 409), and is idempotent.
- **Per-warehouse layers.**
  - Inbound movements open a layer in their warehouse.
  - Issues consume that warehouse's layers plus warehouse-agnostic (`NULL`) layers, i.e. legacy and opening layers.
  - Transfers are no longer layer-neutral. The shipment consumes source layers, and its cost is stored on `stock_transfer_items.unit_cost_out`. The receipt opens a destination layer at that cost, so the stock ledger stays equal to the layers and the GL stays neutral.
- **Cycle counts.** The adjustment journal now posts at the summed `total_value` of the variance movements (the FIFO layer cost), and the count's `total_variance_value` is updated to match.
- **Remaining limits:**
  - Opening and legacy layers are warehouse-agnostic.
  - There is no FIFO on landed-cost or price-variance adjustments.
