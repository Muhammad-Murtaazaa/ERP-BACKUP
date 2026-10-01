-- 032: Moving-average costing audit trail. When inventory.costing_method = MOVING_AVERAGE, every
-- purchase receipt re-computes items.unit_cost and records the change here.
CREATE TABLE IF NOT EXISTS item_cost_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    stock_movement_id UUID,
    method VARCHAR(16) NOT NULL,
    qty_before NUMERIC(24,8) NOT NULL,
    qty_in NUMERIC(24,8) NOT NULL,
    old_cost NUMERIC(24,8) NOT NULL,
    receipt_cost NUMERIC(24,8) NOT NULL,
    new_cost NUMERIC(24,8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_item_cost_changes_item ON item_cost_changes (item_id, created_at);
