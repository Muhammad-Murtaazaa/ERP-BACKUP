-- 022: Supplier management (SUP) — qualification lifecycle with maker-checker approval,
-- certificates with expiry, weighted periodic scorecards, and a procurement guard that refuses
-- purchase orders to blocked / suspended / rejected suppliers.
CREATE TABLE IF NOT EXISTS sup_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    party_id UUID NOT NULL REFERENCES parties(id),
    category VARCHAR(24) NOT NULL CHECK (category IN ('EQUIPMENT','SPARE_PARTS','REFRIGERANT','SUBCONTRACTOR','LOGISTICS','SERVICES','OTHER')),
    risk_level VARCHAR(8) NOT NULL DEFAULT 'MEDIUM' CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
    required_certificates JSONB NOT NULL DEFAULT '["NTN","STRN"]'::jsonb,
    contact_name VARCHAR(255),
    notes TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'PROSPECT' CHECK (status IN ('PROSPECT','UNDER_REVIEW','APPROVED','REJECTED','SUSPENDED','BLOCKED')),
    submitted_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    status_reason TEXT,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sup_profile_party UNIQUE (organization_id, party_id)
);

CREATE TABLE IF NOT EXISTS sup_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    profile_id UUID NOT NULL REFERENCES sup_profiles(id),
    cert_type VARCHAR(24) NOT NULL CHECK (cert_type IN ('NTN','STRN','ISO9001','ISO14001','OEM_AUTHORISATION','INSURANCE','SAFETY','BANK_LETTER','OTHER')),
    reference VARCHAR(120) NOT NULL,
    issued_on DATE,
    expires_on DATE,
    status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_sup_cert_window CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

CREATE TABLE IF NOT EXISTS sup_scorecards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    profile_id UUID NOT NULL REFERENCES sup_profiles(id),
    period VARCHAR(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    quality_score INT NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
    delivery_score INT NOT NULL CHECK (delivery_score BETWEEN 0 AND 100),
    price_score INT NOT NULL CHECK (price_score BETWEEN 0 AND 100),
    service_score INT NOT NULL CHECK (service_score BETWEEN 0 AND 100),
    weighted_score NUMERIC(6,2) NOT NULL,
    grade CHAR(1) NOT NULL,
    on_time_receipts INT,
    total_receipts INT,
    comments TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sup_scorecard_period UNIQUE (profile_id, period)
);
