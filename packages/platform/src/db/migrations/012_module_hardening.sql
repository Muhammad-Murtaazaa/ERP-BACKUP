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

-- Item master: retail/automation attributes.
ALTER TABLE items ADD COLUMN IF NOT EXISTS barcode VARCHAR(64);
ALTER TABLE items ADD COLUMN IF NOT EXISTS plu_code VARCHAR(16);
ALTER TABLE items ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(9, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100);
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_weighed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS reorder_point NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0);
ALTER TABLE items ADD COLUMN IF NOT EXISTS reorder_qty NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0);
ALTER TABLE items ADD COLUMN IF NOT EXISTS preferred_vendor_id UUID REFERENCES parties(id) ON DELETE RESTRICT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS category VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_barcode ON items(organization_id, barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_plu ON items(organization_id, plu_code) WHERE plu_code IS NOT NULL;

-- Trading documents: actors for SoD evidence and line-level tax.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cogs_journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(24, 8) NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(24, 8) NOT NULL DEFAULT 0;
ALTER TABLE ar_invoice_lines ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(24, 8) NOT NULL DEFAULT 0;
ALTER TABLE ar_invoice_lines ADD COLUMN IF NOT EXISTS sales_order_line_id UUID REFERENCES sales_order_lines(id) ON DELETE RESTRICT;
ALTER TABLE ap_invoice_lines ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(24, 8) NOT NULL DEFAULT 0;
ALTER TABLE ap_invoice_lines ADD COLUMN IF NOT EXISTS purchase_order_line_id UUID REFERENCES purchase_order_lines(id) ON DELETE RESTRICT;
ALTER TABLE ar_invoices ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ap_invoices ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ap_invoices ADD COLUMN IF NOT EXISTS price_variance NUMERIC(24, 8) NOT NULL DEFAULT 0;
-- Invoice outstanding can never go negative or exceed the invoice total.
ALTER TABLE ar_invoices DROP CONSTRAINT IF EXISTS ck_ar_outstanding;
ALTER TABLE ar_invoices ADD CONSTRAINT ck_ar_outstanding CHECK (outstanding_amount >= 0 AND outstanding_amount <= total_amount);
ALTER TABLE ap_invoices DROP CONSTRAINT IF EXISTS ck_ap_outstanding;
ALTER TABLE ap_invoices ADD CONSTRAINT ck_ap_outstanding CHECK (outstanding_amount >= 0 AND outstanding_amount <= total_amount);
ALTER TABLE sales_order_lines DROP CONSTRAINT IF EXISTS ck_sol_qty;
ALTER TABLE sales_order_lines ADD CONSTRAINT ck_sol_qty CHECK (fulfilled_quantity >= 0 AND invoiced_quantity >= 0 AND invoiced_quantity <= quantity AND fulfilled_quantity <= quantity);
ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS ck_pol_qty;
ALTER TABLE purchase_order_lines ADD CONSTRAINT ck_pol_qty CHECK (received_quantity >= 0 AND billed_quantity >= 0 AND received_quantity <= quantity AND billed_quantity <= received_quantity);

-- Payments: unapplied remainder and reversible allocations (append-only facts).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS unallocated_amount NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversal_journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE allocations ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

-- Fixed assets: one depreciation entry per asset per period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_depr_period ON asset_depreciation_entries(asset_id, period_id);
