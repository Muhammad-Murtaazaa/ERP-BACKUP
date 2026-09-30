-- Omnysync Database Schema Migration 002: Trading Workflows
-- Parties, Items, Inventory Subledger, Sales Orders, Purchase Orders, AR Invoices, AP Invoices, Payments & Allocations

-- 1. Parties (Customers & Vendors)
CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE RESTRICT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  party_type VARCHAR(20) NOT NULL CHECK (party_type IN ('CUSTOMER', 'VENDOR', 'BOTH')),
  tax_identifier VARCHAR(64),
  email VARCHAR(255),
  phone VARCHAR(64),
  address TEXT,
  credit_limit NUMERIC(24, 8) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_parties_code UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_parties_scope ON parties(organization_id, party_type);

-- 2. Items & Inventory Master
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE RESTRICT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  item_type VARCHAR(20) NOT NULL DEFAULT 'INVENTORY' CHECK (item_type IN ('INVENTORY', 'SERVICE', 'NON_INVENTORY')),
  uom VARCHAR(32) NOT NULL DEFAULT 'UNIT',
  unit_price NUMERIC(24, 8) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(24, 8) NOT NULL DEFAULT 0,
  sales_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  cogs_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  inventory_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_items_code UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_items_scope ON items(organization_id, item_type);

-- 3. Inventory Stock Movements & Subledger
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  movement_type VARCHAR(32) NOT NULL CHECK (movement_type IN ('RECEIPT', 'SHIPMENT', 'ADJUSTMENT', 'OPENING')),
  movement_date DATE NOT NULL,
  quantity NUMERIC(24, 8) NOT NULL,
  unit_cost NUMERIC(24, 8) NOT NULL DEFAULT 0,
  total_value NUMERIC(24, 8) NOT NULL DEFAULT 0,
  reference_type VARCHAR(64),
  reference_id UUID,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(organization_id, item_id, movement_date);

-- 4. Sales Orders
CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  order_number VARCHAR(64) NOT NULL,
  order_date DATE NOT NULL,
  delivery_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'FULFILLED', 'INVOICED', 'CANCELLED')),
  subtotal NUMERIC(24, 8) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  total_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_so_number UNIQUE (legal_entity_id, order_number)
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id UUID PRIMARY KEY,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  line_number INT NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity NUMERIC(24, 8) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(24, 8) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(24, 8) NOT NULL CHECK (line_total >= 0),
  description TEXT,
  fulfilled_quantity NUMERIC(24, 8) NOT NULL DEFAULT 0,
  invoiced_quantity NUMERIC(24, 8) NOT NULL DEFAULT 0,
  CONSTRAINT uq_so_line_num UNIQUE (sales_order_id, line_number)
);

-- 5. Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  po_number VARCHAR(64) NOT NULL,
  po_date DATE NOT NULL,
  expected_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'RECEIVED', 'BILLED', 'CANCELLED')),
  subtotal NUMERIC(24, 8) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  total_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_po_number UNIQUE (legal_entity_id, po_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_number INT NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity NUMERIC(24, 8) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(24, 8) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(24, 8) NOT NULL CHECK (line_total >= 0),
  description TEXT,
  received_quantity NUMERIC(24, 8) NOT NULL DEFAULT 0,
  billed_quantity NUMERIC(24, 8) NOT NULL DEFAULT 0,
  CONSTRAINT uq_po_line_num UNIQUE (purchase_order_id, line_number)
);

-- 6. Customer AR Invoices
CREATE TABLE IF NOT EXISTS ar_invoices (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(64) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED')),
  subtotal NUMERIC(24, 8) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  total_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  outstanding_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  posted_journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_ar_inv_num UNIQUE (legal_entity_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS ar_invoice_lines (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES ar_invoices(id) ON DELETE CASCADE,
  line_number INT NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity NUMERIC(24, 8) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(24, 8) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(24, 8) NOT NULL CHECK (line_total >= 0),
  description TEXT,
  CONSTRAINT uq_ar_line_num UNIQUE (invoice_id, line_number)
);

-- 7. Supplier AP Invoices (Bills)
CREATE TABLE IF NOT EXISTS ap_invoices (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(64) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED')),
  subtotal NUMERIC(24, 8) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  total_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  outstanding_amount NUMERIC(24, 8) NOT NULL DEFAULT 0,
  posted_journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_ap_inv_num UNIQUE (legal_entity_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS ap_invoice_lines (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES ap_invoices(id) ON DELETE CASCADE,
  line_number INT NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity NUMERIC(24, 8) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(24, 8) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(24, 8) NOT NULL CHECK (line_total >= 0),
  description TEXT,
  CONSTRAINT uq_ap_line_num UNIQUE (invoice_id, line_number)
);

-- 8. Payments (Receipts & Disbursements)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('RECEIPT', 'DISBURSEMENT')),
  payment_number VARCHAR(64) NOT NULL,
  payment_date DATE NOT NULL,
  bank_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(24, 8) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  reference VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'CANCELLED')),
  posted_journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_payment_number UNIQUE (legal_entity_id, payment_number)
);

-- 9. Open Item Allocations
CREATE TABLE IF NOT EXISTS allocations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  invoice_type VARCHAR(10) NOT NULL CHECK (invoice_type IN ('AR', 'AP')),
  allocated_amount NUMERIC(24, 8) NOT NULL CHECK (allocated_amount > 0),
  allocated_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_allocations_inv ON allocations(invoice_id, invoice_type);
