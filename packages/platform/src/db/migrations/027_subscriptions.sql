-- 027: Subscriptions / recurring commerce (COM) — plans, customer subscriptions (e.g. HVAC AMC
-- plans), and an idempotent billing run: one billed period per subscription + period start.
CREATE TABLE IF NOT EXISTS com_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    billing_interval VARCHAR(10) NOT NULL CHECK (billing_interval IN ('MONTHLY','QUARTERLY','ANNUAL')),
    price NUMERIC(24,8) NOT NULL CHECK (price > 0),
    tax_rate NUMERIC(6,3) NOT NULL DEFAULT 18 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    item_id UUID NOT NULL REFERENCES items(id),
    visits_per_year INT NOT NULL DEFAULT 0 CHECK (visits_per_year >= 0),
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_com_plan_code UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS com_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    party_id UUID NOT NULL REFERENCES parties(id),
    plan_id UUID NOT NULL REFERENCES com_plans(id),
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct < 100),
    start_date DATE NOT NULL,
    end_date DATE,
    next_bill_date DATE,
    service_contract_id UUID REFERENCES srv_contracts(id),
    status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','CANCELLED','ENDED')),
    cancel_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_com_window CHECK (end_date IS NULL OR end_date > start_date)
);

CREATE TABLE IF NOT EXISTS com_billing_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES com_subscriptions(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    net_amount NUMERIC(24,8) NOT NULL,
    ar_invoice_id UUID REFERENCES ar_invoices(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_com_period UNIQUE (subscription_id, period_start),
    CONSTRAINT ck_com_period CHECK (period_end >= period_start)
);
