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
