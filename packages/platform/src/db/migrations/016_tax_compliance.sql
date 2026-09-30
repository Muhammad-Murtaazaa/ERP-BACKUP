-- 016: Tax compliance (TAX). Effective-dated tax codes, return preparation from the ledger,
-- filing with preparer/filer segregation and a period-guarded settlement journal.
CREATE TABLE IF NOT EXISTS tax_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('OUTPUT','INPUT','WITHHOLDING','EXEMPT')),
    rate NUMERIC(9,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
    is_inclusive BOOLEAN NOT NULL DEFAULT false,
    account_code VARCHAR(16),
    effective_from DATE NOT NULL,
    effective_to DATE,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_tax_window CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT uq_tax_code_from UNIQUE (organization_id, code, effective_from)
);
CREATE TABLE IF NOT EXISTS tax_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    output_tax NUMERIC(24,8) NOT NULL DEFAULT 0,
    input_tax NUMERIC(24,8) NOT NULL DEFAULT 0,
    net_payable NUMERIC(24,8) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FILED','SETTLED','CANCELLED')),
    filing_reference VARCHAR(80),
    filed_by UUID REFERENCES users(id),
    filed_at TIMESTAMPTZ,
    settlement_journal_id UUID REFERENCES journals(id),
    notes TEXT,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_tax_return_window CHECK (period_end >= period_start)
);
-- One live return per period (a cancelled draft may be re-prepared).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_return_period ON tax_returns(organization_id, period_start, period_end) WHERE status <> 'CANCELLED';
