# ADR-002 — The stock ledger is the valuation source; issues use the item's unit cost
Status: accepted • 1 October 2026

## Context
Inventory value was partly held on `items` and partly derived from `stock_movements`, so the two could drift apart. The docs require immutable stock facts and corrections made by reversal.

## Decision
`stock_movements` is the only source of truth for quantity and value. Rows are append-only, and corrections are new, opposite movements. Receipts carry their own cost. Issues (sales, POS, production, scrap) are costed at the item's current `unit_cost`, which acts as a standard cost. The same value is posted to COGS/inventory in the same unit of work. The GL inventory accounts must equal `SUM(stock_movements.total_value)` for each inventory account. The `INV-STOCK-GL` automation checks this every day and raises a CRITICAL alert on any drift above tolerance. Until real costing exists, this check is what surfaces purchase-price variance.

## Consequences / deviation
Moving-average costing, FIFO costing and a purchase-price-variance account are not implemented. This deviates from the costing section of the docs and is a follow-up. Negative stock is blocked unless a manager approves it (POS `NEGATIVE_STOCK` approval), and that override is audited.
