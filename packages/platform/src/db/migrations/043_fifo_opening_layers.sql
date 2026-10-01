-- 043: FIFO opening layers. Switching to FIFO (or running the reconcile tool) aligns open layers with
-- on-hand stock: missing quantity gets an OPENING layer at the item's current cost (consumed first),
-- surplus layer quantity (stock issued while not on FIFO) is trimmed oldest-first.
ALTER TABLE stock_cost_layers ADD COLUMN IF NOT EXISTS layer_source VARCHAR(12) NOT NULL DEFAULT 'RECEIPT' CHECK (layer_source IN ('RECEIPT','OPENING'));
