-- 035: FIFO costing. With inventory.costing_method = FIFO every inbound stock movement opens a cost
-- layer and every outbound movement consumes the oldest layers first; the movement is valued at the
-- consumed layers' cost (ADR-016 addendum). Transfers are valuation-neutral and do not touch layers.
CREATE TABLE IF NOT EXISTS stock_cost_layers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGSERIAL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    stock_movement_id UUID NOT NULL,
    received_date DATE NOT NULL,
    qty_original NUMERIC(24,8) NOT NULL CHECK (qty_original > 0),
    qty_remaining NUMERIC(24,8) NOT NULL CHECK (qty_remaining >= 0 AND qty_remaining <= qty_original),
    unit_cost NUMERIC(24,8) NOT NULL CHECK (unit_cost >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cost_layers_open ON stock_cost_layers (organization_id, item_id, received_date, seq) WHERE qty_remaining > 0;
CREATE TABLE IF NOT EXISTS stock_layer_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    layer_id UUID REFERENCES stock_cost_layers(id),
    stock_movement_id UUID NOT NULL,
    quantity NUMERIC(24,8) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(24,8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_layer_consumptions_mv ON stock_layer_consumptions (stock_movement_id);
