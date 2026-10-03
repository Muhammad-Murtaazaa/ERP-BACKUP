-- 048_construction_enterprise_suite.sql
-- Enterprise Construction Suite: BIM Takeoff, Subcontractor Management (AIA/FIDIC),
-- Daily Site Diary & Plant Logs, Site Material Receipts (MRN), Variations/Change Orders,
-- RFIs & Drawing Register.

-- 1. Project Subcontracts
CREATE TABLE IF NOT EXISTS project_subcontracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    subcontract_number VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    vendor_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    contract_value NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    retention_percentage NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    scope_description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'TERMINATED')),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_prj_subcontract_num UNIQUE (organization_id, subcontract_number)
);

-- 2. Subcontractor Interim Payment Applications / Claims (AIA G702/G703 & FIDIC IPC)
CREATE TABLE IF NOT EXISTS project_subcontract_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subcontract_id UUID NOT NULL REFERENCES project_subcontracts(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    claim_number VARCHAR(64) NOT NULL,
    period_date DATE NOT NULL,
    claimed_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    certified_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    retention_deducted NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    net_payable NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    status VARCHAR(32) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'VERIFIED', 'APPROVED', 'PAID')),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_prj_sub_claim_num UNIQUE (organization_id, claim_number)
);

-- 3. Daily Site Diary (Field Operations)
CREATE TABLE IF NOT EXISTS project_site_diaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    diary_date DATE NOT NULL,
    weather_condition VARCHAR(64) NOT NULL DEFAULT 'Clear / Sunny',
    temperature VARCHAR(32) DEFAULT '28°C',
    manpower_count INT NOT NULL DEFAULT 0,
    equipment_count INT NOT NULL DEFAULT 0,
    work_executed TEXT NOT NULL,
    delays_or_impediments TEXT,
    safety_incidents INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED')),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_prj_site_diary_date UNIQUE (project_id, diary_date)
);

-- 4. Site Manpower Headcount Breakdown
CREATE TABLE IF NOT EXISTS project_daily_manpower (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_diary_id UUID NOT NULL REFERENCES project_site_diaries(id) ON DELETE CASCADE,
    trade_category VARCHAR(64) NOT NULL,
    headcount INT NOT NULL DEFAULT 1,
    hours_worked NUMERIC(8,2) NOT NULL DEFAULT 8.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Site Equipment & Plant Log
CREATE TABLE IF NOT EXISTS project_daily_equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_diary_id UUID NOT NULL REFERENCES project_site_diaries(id) ON DELETE CASCADE,
    equipment_name VARCHAR(128) NOT NULL,
    operating_hours NUMERIC(8,2) NOT NULL DEFAULT 8.00,
    idle_hours NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(32) NOT NULL DEFAULT 'OPERATING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Site Material Receipt Notes (MRN / Goods Receipt on Site)
CREATE TABLE IF NOT EXISTS project_material_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    mrn_number VARCHAR(64) NOT NULL,
    supplier_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    boq_item_id UUID REFERENCES boq_items(id) ON DELETE SET NULL,
    delivery_date DATE NOT NULL,
    vehicle_number VARCHAR(64),
    delivery_ticket_number VARCHAR(64),
    item_description VARCHAR(255) NOT NULL,
    received_quantity NUMERIC(24,8) NOT NULL,
    uom VARCHAR(32) NOT NULL DEFAULT 'UNIT',
    inspected_by VARCHAR(128),
    quality_status VARCHAR(32) NOT NULL DEFAULT 'ACCEPTED' CHECK (quality_status IN ('ACCEPTED', 'CONDITIONALLY_ACCEPTED', 'REJECTED')),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_prj_mrn_number UNIQUE (organization_id, mrn_number)
);

-- 7. Variations & Change Orders (VO / PCO)
CREATE TABLE IF NOT EXISTS project_variations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    variation_number VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    variation_type VARCHAR(64) NOT NULL DEFAULT 'CLIENT_ADDITION' CHECK (variation_type IN ('CLIENT_ADDITION', 'SITE_CONDITION', 'DESIGN_CHANGE', 'VALUE_ENGINEERING')),
    amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    schedule_impact_days INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'SUBMITTED', 'APPROVED', 'REJECTED')),
    reason TEXT,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_prj_variation_num UNIQUE (organization_id, variation_number)
);

-- 8. Requests for Information (RFI)
CREATE TABLE IF NOT EXISTS project_rfis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rfi_number VARCHAR(64) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    question TEXT NOT NULL,
    response TEXT,
    assigned_to VARCHAR(128),
    due_date DATE,
    cost_impact NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    schedule_impact_days INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ANSWERED', 'CLOSED')),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_prj_rfi_num UNIQUE (organization_id, rfi_number)
);

-- 9. Drawing Register & Revisions
CREATE TABLE IF NOT EXISTS project_drawings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    drawing_number VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    discipline VARCHAR(64) NOT NULL DEFAULT 'STRUCTURAL' CHECK (discipline IN ('ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE')),
    revision VARCHAR(32) NOT NULL DEFAULT 'Rev A',
    status VARCHAR(64) NOT NULL DEFAULT 'APPROVED_FOR_CONSTRUCTION' CHECK (status IN ('PRELIMINARY', 'FOR_APPROVAL', 'APPROVED_FOR_CONSTRUCTION', 'SUPERSEDED')),
    scale VARCHAR(32) DEFAULT '1:100',
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_prj_drawing_num UNIQUE (organization_id, drawing_number, revision)
);

-- 10. BIM 3D Takeoff Models
CREATE TABLE IF NOT EXISTS project_bim_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    model_name VARCHAR(128) NOT NULL,
    file_format VARCHAR(32) NOT NULL DEFAULT 'IFC',
    total_elements INT NOT NULL DEFAULT 0,
    takeoff_volume_m3 NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
