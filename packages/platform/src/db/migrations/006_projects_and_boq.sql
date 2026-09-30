-- 006_projects_and_boq.sql
-- Omnysync ERP Milestone 6: Projects, Cost Centers, Bill of Quantities (BOQ) & Milestone Progress Invoicing

-- 1. Cost Centers
CREATE TABLE IF NOT EXISTS cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    cost_center_type VARCHAR(32) NOT NULL DEFAULT 'OPERATIONAL' CHECK (cost_center_type IN ('OPERATIONAL', 'PROJECT', 'OVERHEAD')),
    manager_name VARCHAR(255),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cost_center_code_org UNIQUE (organization_id, code)
);

-- 2. Projects
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    customer_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    manager_name VARCHAR(255),
    project_type VARCHAR(32) NOT NULL DEFAULT 'CONSTRUCTION' CHECK (project_type IN ('CONSTRUCTION', 'CONSULTING', 'INTERNAL', 'EPC', 'SERVICES')),
    contract_value NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    budgeted_cost NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    retention_percentage NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    status VARCHAR(32) NOT NULL DEFAULT 'ESTIMATING' CHECK (status IN ('ESTIMATING', 'APPROVED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CLOSED')),
    start_date DATE NOT NULL,
    end_date DATE,
    cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_code_org UNIQUE (organization_id, code)
);

-- 3. Project Work Breakdown Structure (WBS) Nodes
CREATE TABLE IF NOT EXISTS project_wbs_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    wbs_code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES project_wbs_nodes(id) ON DELETE CASCADE,
    budget_cost NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    progress_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_wbs_code_project UNIQUE (project_id, wbs_code)
);

-- 4. Bill of Quantities (BOQ) Header and Items
CREATE TABLE IF NOT EXISTS bill_of_quantities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    boq_number VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    version VARCHAR(32) NOT NULL DEFAULT '1.0',
    total_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'REVISED')),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_boq_number_org UNIQUE (organization_id, boq_number)
);

CREATE TABLE IF NOT EXISTS boq_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boq_id UUID NOT NULL REFERENCES bill_of_quantities(id) ON DELETE CASCADE,
    wbs_node_id UUID REFERENCES project_wbs_nodes(id) ON DELETE SET NULL,
    item_code VARCHAR(32) NOT NULL,
    description TEXT NOT NULL,
    uom VARCHAR(32) NOT NULL DEFAULT 'UNIT',
    contract_quantity NUMERIC(24,8) NOT NULL,
    unit_rate NUMERIC(24,8) NOT NULL,
    total_amount NUMERIC(24,8) NOT NULL,
    certified_quantity NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Progress Certificates (Interim Payment Certificates - IPC)
CREATE TABLE IF NOT EXISTS progress_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_number VARCHAR(64) NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    boq_id UUID NOT NULL REFERENCES bill_of_quantities(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES fiscal_periods(id),
    certificate_date DATE NOT NULL,
    gross_certified_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    retention_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    net_certified_amount NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CERTIFIED', 'INVOICED', 'CANCELLED')),
    journal_id UUID REFERENCES journals(id),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_progress_cert_number UNIQUE (organization_id, certificate_number)
);

CREATE TABLE IF NOT EXISTS progress_certificate_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_id UUID NOT NULL REFERENCES progress_certificates(id) ON DELETE CASCADE,
    boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
    previous_quantity NUMERIC(24,8) NOT NULL DEFAULT 0.00000000,
    current_quantity NUMERIC(24,8) NOT NULL,
    cumulative_quantity NUMERIC(24,8) NOT NULL,
    unit_rate NUMERIC(24,8) NOT NULL,
    current_amount NUMERIC(24,8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
