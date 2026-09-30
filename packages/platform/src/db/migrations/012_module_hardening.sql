-- ============================================================================
-- 012: Module hardening columns (segregation of duties evidence, state guards,
-- off-cycle payroll, revision counters). Append-only, additive.
-- ============================================================================

-- Payroll: approval/posting/disbursement actors (SoD evidence) and run type.
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS disbursed_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS run_type VARCHAR(16) NOT NULL DEFAULT 'REGULAR';
-- One regular pay run per entity/month (off-cycle corrections use run_type OFF_CYCLE).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_regular_month ON payroll_runs(legal_entity_id, month_year)
  WHERE run_type = 'REGULAR' AND status <> 'CANCELLED';

-- Inventory: stock movements are now tracked per physical warehouse (location_id).
-- Legacy rows (location_id NULL) belong to the organisation's default warehouse.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN (
  'RECEIPT', 'SHIPMENT', 'ADJUSTMENT', 'OPENING', 'TRANSFER_OUT', 'TRANSFER_IN',
  'PRODUCTION_ISSUE', 'PRODUCTION_RECEIPT', 'PRODUCTION_SCRAP', 'POS_SALE', 'POS_RETURN',
  'SALES_RETURN', 'PURCHASE_RETURN', 'COUNT_ADJUSTMENT'));
CREATE INDEX IF NOT EXISTS idx_stock_movements_location ON stock_movements(organization_id, item_id, location_id);

-- Inventory counts: recorder vs adjustment approver (SoD evidence).
ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS shipped_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES users(id) ON DELETE RESTRICT;
