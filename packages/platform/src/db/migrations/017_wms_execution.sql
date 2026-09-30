-- 017: Warehouse execution (WMS). Bin-level stock (a sub-ledger of the warehouse stock ledger),
-- directed putaway and pick lists generated from confirmed sales orders.
ALTER TABLE warehouse_bins ADD COLUMN IF NOT EXISTS bin_type VARCHAR(16) NOT NULL DEFAULT 'PICK' CHECK (bin_type IN ('PICK','BULK','STAGING','QUARANTINE'));
ALTER TABLE warehouse_bins ADD COLUMN IF NOT EXISTS capacity_qty NUMERIC(24,8);
CREATE TABLE IF NOT EXISTS bin_stock (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bin_id UUID NOT NULL REFERENCES warehouse_bins(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    quantity NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bin_id, item_id)
);
CREATE TABLE IF NOT EXISTS bin_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bin_id UUID NOT NULL REFERENCES warehouse_bins(id),
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC(24,8) NOT NULL,
    movement_type VARCHAR(16) NOT NULL CHECK (movement_type IN ('PUTAWAY','PICK','MOVE_OUT','MOVE_IN')),
    reference_type VARCHAR(32),
    reference_id UUID,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pick_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PICKING','PICKED','CANCELLED')),
    shortage BOOLEAN NOT NULL DEFAULT false,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pick_list_open_so ON pick_lists(sales_order_id) WHERE status <> 'CANCELLED';
CREATE TABLE IF NOT EXISTS pick_list_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pick_list_id UUID NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    bin_id UUID REFERENCES warehouse_bins(id),
    qty_requested NUMERIC(24,8) NOT NULL CHECK (qty_requested > 0),
    qty_picked NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (qty_picked >= 0),
    CONSTRAINT ck_pick_not_over CHECK (qty_picked <= qty_requested)
);
