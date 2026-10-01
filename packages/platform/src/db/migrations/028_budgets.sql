-- 028: Planning & budgeting (EPM) — versioned P&L budgets per account and month, approval with
-- segregation of duties, lock on approval, and budget-vs-actual from posted journals.
CREATE TABLE IF NOT EXISTS epm_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    fiscal_year INT NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
    scenario VARCHAR(10) NOT NULL DEFAULT 'BUDGET' CHECK (scenario IN ('BUDGET','FORECAST')),
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    supersedes_id UUID REFERENCES epm_budgets(id),
    notes TEXT,
    submitted_by UUID REFERENCES users(id),
    submitted_at TIMESTAMPTZ,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','SUPERSEDED','ARCHIVED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_epm_budget_version UNIQUE (organization_id, code, version)
);

CREATE TABLE IF NOT EXISTS epm_budget_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    budget_id UUID NOT NULL REFERENCES epm_budgets(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id),
    period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    amount NUMERIC(24,8) NOT NULL CHECK (amount >= 0),
    CONSTRAINT uq_epm_line UNIQUE (budget_id, account_id, period_month)
);
CREATE INDEX IF NOT EXISTS idx_epm_lines_budget ON epm_budget_lines (budget_id);
