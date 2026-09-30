-- 007_fixed_assets.sql
-- Omnysync ERP Milestone 7: Fixed Assets Register, Depreciation Engine & Capitalization

-- 1. Asset Categories
CREATE TABLE IF NOT EXISTS asset_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    depreciation_method VARCHAR(32) NOT NULL DEFAULT 'STRAIGHT_LINE' CHECK (depreciation_method IN ('STRAIGHT_LINE', 'DECLINING_BALANCE', 'UNITS_OF_PRODUCTION')),
    useful_life_months INT NOT NULL DEFAULT 60,
    salvage_value_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    asset_cost_account_id UUID REFERENCES accounts(id),
    accumulated_deprec_account_id UUID REFERENCES accounts(id),
    deprec_expense_account_id UUID REFERENCES accounts(id),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_asset_category_code_org UNIQUE (organization_id, code)
);

-- 2. Fixed Assets
CREATE TABLE IF NOT EXISTS fixed_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_number VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category_id UUID NOT NULL REFERENCES asset_categories(id) ON DELETE RESTRICT,
    acquisition_date DATE NOT NULL,
    acquisition_cost NUMERIC(24,8) NOT NULL,
    salvage_value NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    useful_life_months INT NOT NULL,
    depreciation_method VARCHAR(32) NOT NULL DEFAULT 'STRAIGHT_LINE' CHECK (depreciation_method IN ('STRAIGHT_LINE', 'DECLINING_BALANCE', 'UNITS_OF_PRODUCTION')),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED', 'WRITTEN_OFF')),
    location VARCHAR(255),
    custodian_name VARCHAR(255),
    serial_number VARCHAR(128),
    current_book_value NUMERIC(24,8) NOT NULL,
    accumulated_depreciation NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    disposal_date DATE,
    disposal_proceeds NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    disposal_journal_id UUID REFERENCES journals(id),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fixed_asset_num_org UNIQUE (organization_id, asset_number)
);

-- 3. Asset Depreciation Entries
CREATE TABLE IF NOT EXISTS asset_depreciation_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES fiscal_periods(id),
    entry_date DATE NOT NULL,
    depreciation_amount NUMERIC(24,8) NOT NULL,
    accumulated_depreciation_after NUMERIC(24,8) NOT NULL,
    book_value_after NUMERIC(24,8) NOT NULL,
    journal_id UUID REFERENCES journals(id),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
