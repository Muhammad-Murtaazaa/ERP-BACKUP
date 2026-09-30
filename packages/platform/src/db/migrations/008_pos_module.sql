-- 008_pos_module.sql
-- Omnysync ERP: Point of Sale (POS) Terminal, Shifts, and Cash Drawer Reconciliations

-- 1. POS Registers
CREATE TABLE IF NOT EXISTS pos_registers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    register_code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    cash_account_id UUID REFERENCES accounts(id),
    card_clearing_account_id UUID REFERENCES accounts(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pos_reg_code_org UNIQUE (organization_id, register_code)
);

-- 2. POS Sessions (Cashier Shifts)
CREATE TABLE IF NOT EXISTS pos_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    register_id UUID NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
    cashier_id UUID NOT NULL REFERENCES users(id),
    cashier_name VARCHAR(255) NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    opening_float NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    cash_sales_total NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    card_sales_total NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    expected_cash_drawer NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    actual_cash_drawer NUMERIC(24,8),
    cash_difference NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    closing_journal_id UUID REFERENCES journals(id),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. POS Orders
CREATE TABLE IF NOT EXISTS pos_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
    order_number VARCHAR(64) NOT NULL,
    customer_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    subtotal NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    discount_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    tax_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    total_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    payment_method VARCHAR(32) NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'CARD', 'SPLIT')),
    cash_tendered NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    change_due NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED', 'REFUNDED')),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pos_order_num_org UNIQUE (organization_id, order_number)
);

-- 4. POS Order Lines
CREATE TABLE IF NOT EXISTS pos_order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    item_code VARCHAR(64) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(24,8) NOT NULL,
    unit_price NUMERIC(24,8) NOT NULL,
    line_total NUMERIC(24,8) NOT NULL,
    tax_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
