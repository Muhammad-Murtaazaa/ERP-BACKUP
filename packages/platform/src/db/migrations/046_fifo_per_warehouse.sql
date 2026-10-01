-- 046: FIFO layers per warehouse. Inbound movements open a layer in their warehouse; issues consume that
-- warehouse's layers (plus warehouse-agnostic legacy/opening layers). Transfers move layers: the shipment
-- consumes source layers and the receipt opens a destination layer at the shipped cost (GL-neutral).
ALTER TABLE stock_cost_layers ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE stock_transfer_items ADD COLUMN IF NOT EXISTS unit_cost_out NUMERIC(24,8);
CREATE INDEX IF NOT EXISTS idx_cost_layers_wh ON stock_cost_layers (organization_id, item_id, warehouse_id) WHERE qty_remaining > 0;
