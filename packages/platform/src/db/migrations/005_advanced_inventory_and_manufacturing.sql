-- 005_advanced_inventory_and_manufacturing.sql
-- Omnysync ERP Milestone 5: Advanced Inventory, Multi-Warehouse/Bins, Lots/Serials, Stock Counts & Manufacturing BOM/Work Orders

-- 1. Warehouses, Zones & Storage Bins
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_warehouse_code_org UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS warehouse_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    zone_type VARCHAR(32) NOT NULL DEFAULT 'STORAGE' CHECK (zone_type IN ('STORAGE', 'PICKING', 'RECEIVING', 'SHIPPING', 'QUARANTINE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_zone_code_warehouse UNIQUE (warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS warehouse_bins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES warehouse_zones(id) ON DELETE SET NULL,
    bin_code VARCHAR(32) NOT NULL,
    max_weight_capacity NUMERIC(12,2),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bin_code_warehouse UNIQUE (warehouse_id, bin_code)
);

-- 2. Item Lots and Serials
CREATE TABLE IF NOT EXISTS item_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    lot_number VARCHAR(64) NOT NULL,
    manufacture_date DATE,
    expiry_date DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'QUARANTINE', 'EXPIRED', 'DEPLETED')),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_item_lot_number UNIQUE (item_id, lot_number)
);

CREATE TABLE IF NOT EXISTS item_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    serial_number VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK', 'RESERVED', 'SHIPPED', 'RETIRED')),
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    bin_id UUID REFERENCES warehouse_bins(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_item_serial_number UNIQUE (item_id, serial_number)
);

-- 3. Inter-Warehouse Stock Transfers
CREATE TABLE IF NOT EXISTS stock_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_number VARCHAR(64) NOT NULL,
    source_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    destination_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED')),
    transfer_date DATE NOT NULL,
    notes TEXT,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_stock_transfer_number UNIQUE (organization_id, transfer_number)
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    requested_qty NUMERIC(24,8) NOT NULL,
    shipped_qty NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    received_qty NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    lot_id UUID REFERENCES item_lots(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Physical Inventory Cycle Counts & Adjustments
CREATE TABLE IF NOT EXISTS inventory_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    count_number VARCHAR(64) NOT NULL,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    period_id UUID NOT NULL REFERENCES fiscal_periods(id),
    count_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'RECONCILED', 'POSTED', 'CANCELLED')),
    total_variance_value NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    journal_id UUID REFERENCES journals(id),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_inventory_count_number UNIQUE (organization_id, count_number)
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    count_id UUID NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    system_qty NUMERIC(24,8) NOT NULL,
    counted_qty NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    variance_qty NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    unit_cost NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    variance_value NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    lot_id UUID REFERENCES item_lots(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Bills of Materials (BOM) & Assembly Manufacturing
CREATE TABLE IF NOT EXISTS bill_of_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_number VARCHAR(64) NOT NULL,
    finished_item_id UUID NOT NULL REFERENCES items(id),
    name VARCHAR(255) NOT NULL,
    version VARCHAR(32) NOT NULL DEFAULT '1.0',
    yield_quantity NUMERIC(24,8) NOT NULL DEFAULT 1.00000000,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'OBSOLETE')),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bom_number UNIQUE (organization_id, bom_number)
);

CREATE TABLE IF NOT EXISTS bom_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
    component_item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC(24,8) NOT NULL,
    scrap_percentage NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Manufacturing Work Orders
CREATE TABLE IF NOT EXISTS work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_number VARCHAR(64) NOT NULL,
    bom_id UUID NOT NULL REFERENCES bill_of_materials(id),
    finished_item_id UUID NOT NULL REFERENCES items(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    target_qty NUMERIC(24,8) NOT NULL,
    completed_qty NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    scrapped_qty NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    status VARCHAR(32) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED')),
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    total_material_cost NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    completion_journal_id UUID REFERENCES journals(id),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_work_order_number UNIQUE (organization_id, work_order_number)
);

CREATE TABLE IF NOT EXISTS work_order_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    component_item_id UUID NOT NULL REFERENCES items(id),
    consumed_qty NUMERIC(24,8) NOT NULL,
    unit_cost NUMERIC(24,8) NOT NULL,
    total_cost NUMERIC(24,8) NOT NULL,
    lot_id UUID REFERENCES item_lots(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
