-- 019: Service, support & field operations (SRV). HVAC/home-services focus:
-- cases with business-hours SLAs, contracts/warranties (entitlements), technician dispatch with
-- hard capacity conflicts, work orders with mandatory checklists and customer sign-off, parts
-- through the stock ledger (replay-safe), time with overlap checks and one-time billing to AR.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN (
  'RECEIPT', 'SHIPMENT', 'ADJUSTMENT', 'OPENING', 'TRANSFER_OUT', 'TRANSFER_IN',
  'PRODUCTION_ISSUE', 'PRODUCTION_RECEIPT', 'PRODUCTION_SCRAP', 'POS_SALE', 'POS_RETURN',
  'SALES_RETURN', 'PURCHASE_RETURN', 'COUNT_ADJUSTMENT', 'SERVICE_ISSUE', 'SERVICE_RETURN'));

CREATE TABLE IF NOT EXISTS srv_technicians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    user_id UUID REFERENCES users(id),
    employee_id UUID REFERENCES employees(id),
    skills TEXT,
    zone VARCHAR(64),
    phone VARCHAR(40),
    hourly_cost NUMERIC(24,8) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_srv_tech_code UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS srv_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    party_id UUID NOT NULL REFERENCES parties(id),
    contract_type VARCHAR(16) NOT NULL CHECK (contract_type IN ('WARRANTY','AMC','SLA_ONLY')),
    title VARCHAR(255) NOT NULL,
    site_address TEXT,
    equipment TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    response_hours INT NOT NULL DEFAULT 4 CHECK (response_hours BETWEEN 1 AND 720),
    resolution_hours INT NOT NULL DEFAULT 24 CHECK (resolution_hours BETWEEN 1 AND 2160),
    covers_labour BOOLEAN NOT NULL DEFAULT false,
    covers_parts BOOLEAN NOT NULL DEFAULT false,
    visits_included INT NOT NULL DEFAULT 0 CHECK (visits_included >= 0),
    visits_used INT NOT NULL DEFAULT 0 CHECK (visits_used >= 0),
    pm_interval_months INT CHECK (pm_interval_months IS NULL OR pm_interval_months BETWEEN 1 AND 24),
    next_pm_date DATE,
    contract_value NUMERIC(24,8) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','EXPIRED','CANCELLED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_srv_contract_window CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS srv_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    party_id UUID NOT NULL REFERENCES parties(id),
    contract_id UUID REFERENCES srv_contracts(id),
    channel VARCHAR(16) NOT NULL DEFAULT 'PHONE' CHECK (channel IN ('PHONE','EMAIL','WHATSAPP','PORTAL','WALK_IN','PREVENTIVE')),
    external_ref VARCHAR(120),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(24) NOT NULL DEFAULT 'REPAIR' CHECK (category IN ('REPAIR','INSTALLATION','MAINTENANCE','INSPECTION','COMPLAINT','OTHER')),
    priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    site_address TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','TRIAGED','SCHEDULED','IN_PROGRESS','ON_HOLD','RESOLVED','CLOSED','CANCELLED')),
    owner_user_id UUID REFERENCES users(id),
    triage_reason TEXT,
    response_due_at TIMESTAMPTZ,
    resolution_due_at TIMESTAMPTZ,
    first_response_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    paused_minutes INT NOT NULL DEFAULT 0,
    resolution_summary TEXT,
    pm_due_date DATE,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- SRV-001: a retried channel request (same external reference) creates one case.
CREATE UNIQUE INDEX IF NOT EXISTS uq_srv_case_channel_ref ON srv_cases(organization_id, channel, external_ref) WHERE external_ref IS NOT NULL;
-- SRV-013: one preventive case per contract occurrence.
CREATE UNIQUE INDEX IF NOT EXISTS uq_srv_case_pm ON srv_cases(contract_id, pm_due_date) WHERE pm_due_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS srv_work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    case_id UUID NOT NULL REFERENCES srv_cases(id),
    technician_id UUID REFERENCES srv_technicians(id),
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    status VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','DISPATCHED','IN_PROGRESS','COMPLETED','BILLED','CANCELLED')),
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    instructions TEXT,
    resolution_notes TEXT,
    customer_signoff_name VARCHAR(255),
    signed_at TIMESTAMPTZ,
    signoff_hash VARCHAR(64),
    warranty_covered BOOLEAN NOT NULL DEFAULT false,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    ar_invoice_id UUID REFERENCES ar_invoices(id),
    billed_amount NUMERIC(24,8),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_srv_wo_window CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start)
);
CREATE INDEX IF NOT EXISTS idx_srv_wo_tech ON srv_work_orders(technician_id, scheduled_start);

CREATE TABLE IF NOT EXISTS srv_work_order_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    work_order_id UUID NOT NULL REFERENCES srv_work_orders(id),
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC(24,8) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(24,8) NOT NULL,
    unit_price NUMERIC(24,8) NOT NULL,
    chargeable BOOLEAN NOT NULL DEFAULT true,
    issue_key VARCHAR(120) NOT NULL,
    stock_movement_id UUID,
    journal_id UUID REFERENCES journals(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_srv_part_issue UNIQUE (organization_id, issue_key)
);

CREATE TABLE IF NOT EXISTS srv_time_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    work_order_id UUID NOT NULL REFERENCES srv_work_orders(id),
    technician_id UUID NOT NULL REFERENCES srv_technicians(id),
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    minutes INT NOT NULL CHECK (minutes > 0),
    billable BOOLEAN NOT NULL DEFAULT true,
    status VARCHAR(16) NOT NULL DEFAULT 'LOGGED' CHECK (status IN ('LOGGED','APPROVED','REJECTED')),
    approved_by UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_srv_time_window CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS srv_extra_work (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    work_order_id UUID NOT NULL REFERENCES srv_work_orders(id),
    description VARCHAR(500) NOT NULL,
    amount NUMERIC(24,8) NOT NULL CHECK (amount > 0),
    status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','ACCEPTED','DECLINED')),
    accepted_by_name VARCHAR(255),
    decided_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_job_type_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_job_type_check CHECK (job_type IN (
  'REORDER_ALERTS','AR_DUNNING','AP_DUE_PROPOSALS','RECURRING_JOURNALS','BANK_AUTO_MATCH','STOCK_GL_RECON',
  'PM_WORK_ORDERS','DEPRECIATION_DUE','POS_SHIFT_MONITOR','APPROVAL_AGING','PERIOD_CLOSE_REMINDER','SERVICE_SLA_PM'));
