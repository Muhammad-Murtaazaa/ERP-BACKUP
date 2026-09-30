-- 013_pos_retail.sql
-- Big-box retail checkout: register settings, multi-tender, held carts, manager
-- approvals, cash movements, returns, gift cards / store credit, loyalty,
-- promotions, drawer audit trail and X/Z reports.

-- 1. Register settings
ALTER TABLE pos_registers ADD COLUMN IF NOT EXISTS default_tax_rate NUMERIC(9,4) NOT NULL DEFAULT 0 CHECK (default_tax_rate >= 0 AND default_tax_rate <= 100);
ALTER TABLE pos_registers ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pos_registers ADD COLUMN IF NOT EXISTS cash_rounding_increment NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (cash_rounding_increment >= 0);
ALTER TABLE pos_registers ADD COLUMN IF NOT EXISTS max_cashier_discount_percent NUMERIC(9,4) NOT NULL DEFAULT 10 CHECK (max_cashier_discount_percent >= 0 AND max_cashier_discount_percent <= 100);
ALTER TABLE pos_registers ADD COLUMN IF NOT EXISTS receipt_header TEXT;
ALTER TABLE pos_registers ADD COLUMN IF NOT EXISTS receipt_footer TEXT;
ALTER TABLE pos_registers ADD COLUMN IF NOT EXISTS last_z_number INTEGER NOT NULL DEFAULT 0;

-- 2. Sessions: business date, cash movement totals, counts, Z report
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS cash_refunds_total NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS paid_in_total NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS paid_out_total NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS safe_drop_total NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS opening_count JSONB;
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS closing_count JSONB;
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS z_number INTEGER;
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS z_report JSONB;
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);
ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS variance_notes TEXT;
-- one open shift per register (race-proof, replaces the check-then-insert)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_open_session_per_register ON pos_sessions(register_id) WHERE status = 'OPEN';

-- 3. Orders: tender/void/return metadata
ALTER TABLE pos_orders DROP CONSTRAINT IF EXISTS pos_orders_payment_method_check;
ALTER TABLE pos_orders ADD CONSTRAINT pos_orders_payment_method_check CHECK (payment_method IN ('CASH','CARD','WALLET','STORE_CREDIT','GIFT_CARD','LOYALTY','SPLIT'));
ALTER TABLE pos_orders DROP CONSTRAINT IF EXISTS pos_orders_status_check;
ALTER TABLE pos_orders ADD CONSTRAINT pos_orders_status_check CHECK (status IN ('COMPLETED','VOIDED','REFUNDED','PARTIALLY_REFUNDED'));
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS cashier_id UUID REFERENCES users(id);
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS register_id UUID REFERENCES pos_registers(id);
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS promo_discount NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS net_amount NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS cash_rounding NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS total_tendered NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS coupon_codes TEXT[];
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS applied_promotions JSONB;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS loyalty_points_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS journal_id UUID REFERENCES journals(id);
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS void_journal_id UUID REFERENCES journals(id);
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id);
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS reprint_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS client_ref VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_orders_client_ref ON pos_orders(organization_id, client_ref) WHERE client_ref IS NOT NULL;
ALTER TABLE pos_orders ADD CONSTRAINT chk_pos_refund_le_total CHECK (refunded_amount >= 0 AND refunded_amount <= total_amount + cash_rounding);

ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS line_number INTEGER;
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS list_price NUMERIC(24,8);
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS net_amount NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(9,4) NOT NULL DEFAULT 0;
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS returned_quantity NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS refunded_net NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS refunded_tax NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS applied_promotions TEXT[];
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS scanned_code VARCHAR(64);
ALTER TABLE pos_order_lines ADD COLUMN IF NOT EXISTS override_approval_id UUID;
ALTER TABLE pos_order_lines ADD CONSTRAINT chk_pos_line_returned CHECK (returned_quantity >= 0 AND returned_quantity <= quantity);

-- 4. Tenders
CREATE TABLE IF NOT EXISTS pos_tenders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES pos_orders(id) ON DELETE RESTRICT,
    tender_type VARCHAR(20) NOT NULL CHECK (tender_type IN ('CASH','CARD','WALLET','STORE_CREDIT','GIFT_CARD','LOYALTY')),
    amount_tendered NUMERIC(24,8) NOT NULL CHECK (amount_tendered > 0),
    applied_amount NUMERIC(24,8) NOT NULL CHECK (applied_amount >= 0),
    refunded_amount NUMERIC(24,8) NOT NULL DEFAULT 0,
    reference VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_pos_tender_refund CHECK (refunded_amount >= 0 AND refunded_amount <= applied_amount)
);
CREATE INDEX IF NOT EXISTS idx_pos_tenders_order ON pos_tenders(order_id);

-- 5. Held / parked carts
CREATE TABLE IF NOT EXISTS pos_held_carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
    register_id UUID NOT NULL REFERENCES pos_registers(id),
    label VARCHAR(128) NOT NULL,
    customer_id UUID REFERENCES parties(id),
    cart JSONB NOT NULL,
    item_count NUMERIC(24,8) NOT NULL DEFAULT 0,
    estimated_total NUMERIC(24,8) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','RECALLED','DISCARDED')),
    held_by UUID NOT NULL REFERENCES users(id),
    recalled_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recalled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pos_held_open ON pos_held_carts(organization_id, register_id, status);

-- 6. Manager PINs and single-use approvals
CREATE TABLE IF NOT EXISTS pos_manager_pins (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS pos_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL CHECK (action IN ('PRICE_OVERRIDE','DISCOUNT','VOID_LINE','VOID_ORDER','RETURN','RETURN_NO_RECEIPT','NO_SALE','PAID_OUT','CLOSE_VARIANCE','NEGATIVE_STOCK')),
    requested_by UUID NOT NULL REFERENCES users(id),
    approved_by UUID NOT NULL REFERENCES users(id),
    context JSONB,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    consumed_ref VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_pos_approval_sod CHECK (approved_by <> requested_by)
);

-- 7. Cash movements (paid in / paid out / safe drop / no-sale drawer opens)
CREATE TABLE IF NOT EXISTS pos_cash_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE RESTRICT,
    movement_type VARCHAR(16) NOT NULL CHECK (movement_type IN ('PAID_IN','PAID_OUT','SAFE_DROP')),
    amount NUMERIC(24,8) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    approval_id UUID REFERENCES pos_approvals(id),
    journal_id UUID REFERENCES journals(id),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Returns
CREATE TABLE IF NOT EXISTS pos_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    return_number VARCHAR(64) NOT NULL,
    session_id UUID NOT NULL REFERENCES pos_sessions(id),
    original_order_id UUID REFERENCES pos_orders(id),
    customer_id UUID REFERENCES parties(id),
    with_receipt BOOLEAN NOT NULL,
    net_amount NUMERIC(24,8) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(24,8) NOT NULL DEFAULT 0,
    total_amount NUMERIC(24,8) NOT NULL DEFAULT 0,
    refund_tenders JSONB NOT NULL,
    reason TEXT NOT NULL,
    restock BOOLEAN NOT NULL DEFAULT TRUE,
    approval_id UUID REFERENCES pos_approvals(id),
    journal_id UUID REFERENCES journals(id),
    exchange_order_id UUID REFERENCES pos_orders(id),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pos_return_number UNIQUE (organization_id, return_number)
);
CREATE TABLE IF NOT EXISTS pos_return_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID NOT NULL REFERENCES pos_returns(id) ON DELETE CASCADE,
    original_line_id UUID REFERENCES pos_order_lines(id),
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC(24,8) NOT NULL CHECK (quantity > 0),
    net_amount NUMERIC(24,8) NOT NULL,
    tax_amount NUMERIC(24,8) NOT NULL,
    unit_cost NUMERIC(24,8) NOT NULL DEFAULT 0
);

-- 9. Stored value: gift cards and store credit (one ledger, balance = SUM(amount))
CREATE TABLE IF NOT EXISTS pos_stored_value_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('GIFT_CARD','STORE_CREDIT')),
    code VARCHAR(64) NOT NULL,
    customer_id UUID REFERENCES parties(id),
    balance NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pos_sv_code UNIQUE (organization_id, kind, code)
);
CREATE TABLE IF NOT EXISTS pos_stored_value_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES pos_stored_value_accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(24,8) NOT NULL,
    reference_type VARCHAR(32) NOT NULL,
    reference_id UUID,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Loyalty
CREATE TABLE IF NOT EXISTS pos_loyalty_accounts (
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
    lifetime_points INTEGER NOT NULL DEFAULT 0,
    tier VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
    PRIMARY KEY (organization_id, customer_id)
);
CREATE TABLE IF NOT EXISTS pos_loyalty_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES parties(id),
    points INTEGER NOT NULL,
    reference_type VARCHAR(32) NOT NULL,
    reference_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Promotions (internal rules engine configuration)
CREATE TABLE IF NOT EXISTS pos_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    promo_type VARCHAR(16) NOT NULL CHECK (promo_type IN ('BOGO','MIX_MATCH','BUNDLE','TIERED','COUPON','CART_PERCENT')),
    rule JSONB NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    starts_on DATE,
    ends_on DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pos_promo_code UNIQUE (organization_id, code),
    CONSTRAINT chk_pos_promo_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

-- 12. Drawer & cashier accountability trail (append-only)
CREATE TABLE IF NOT EXISTS pos_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    register_id UUID REFERENCES pos_registers(id),
    session_id UUID REFERENCES pos_sessions(id),
    user_id UUID REFERENCES users(id),
    event_type VARCHAR(40) NOT NULL,
    reference_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_audit_session ON pos_audit_events(session_id, created_at);

CREATE OR REPLACE FUNCTION pos_audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pos_audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_pos_audit_immutable ON pos_audit_events;
CREATE TRIGGER trg_pos_audit_immutable BEFORE UPDATE OR DELETE ON pos_audit_events
  FOR EACH ROW EXECUTE FUNCTION pos_audit_events_immutable();
