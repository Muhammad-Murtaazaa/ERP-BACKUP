-- Migration: 009_quality_management.sql
-- Description: Quality Inspection Plans, Inspection Lots, Results, Non-Conformance Reports (NCR), and Certificate of Analysis (CoA)

CREATE TABLE IF NOT EXISTS quality_inspection_plans (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  inspection_type VARCHAR(50) NOT NULL DEFAULT 'RECEIVING', -- 'RECEIVING', 'IN_PROCESS', 'FINAL'
  sample_size NUMERIC(24, 8) NOT NULL DEFAULT 1.0,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_inspection_plan_params (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES quality_inspection_plans(id) ON DELETE CASCADE,
  param_name VARCHAR(100) NOT NULL,
  data_type VARCHAR(50) NOT NULL DEFAULT 'NUMERIC', -- 'NUMERIC', 'BOOLEAN', 'TEXT'
  target_value VARCHAR(100),
  min_tolerance NUMERIC(24, 8),
  max_tolerance NUMERIC(24, 8),
  uom VARCHAR(50),
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_inspection_lots (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  lot_number VARCHAR(50) NOT NULL,
  source_type VARCHAR(50) NOT NULL DEFAULT 'GRN', -- 'GRN', 'WORK_ORDER', 'MANUAL'
  source_id UUID,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  batch_number VARCHAR(100),
  quantity NUMERIC(24, 8) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'IN_INSPECTION', 'ACCEPTED', 'REJECTED', 'CONDITIONALLY_ACCEPTED'
  usage_decision_notes TEXT,
  inspector_id UUID REFERENCES users(id) ON DELETE SET NULL,
  inspected_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_inspection_results (
  id UUID PRIMARY KEY,
  lot_id UUID NOT NULL REFERENCES quality_inspection_lots(id) ON DELETE CASCADE,
  param_name VARCHAR(100) NOT NULL,
  measured_numeric_value NUMERIC(24, 8),
  measured_text_value VARCHAR(255),
  is_pass BOOLEAN NOT NULL,
  inspector_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_non_conformance_reports (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ncr_number VARCHAR(50) NOT NULL,
  lot_id UUID NOT NULL REFERENCES quality_inspection_lots(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  defect_severity VARCHAR(50) NOT NULL DEFAULT 'MAJOR', -- 'MINOR', 'MAJOR', 'CRITICAL'
  root_cause TEXT,
  corrective_action TEXT,
  disposition VARCHAR(50) NOT NULL DEFAULT 'REWORK', -- 'REWORK', 'SCRAP', 'RETURN_TO_VENDOR', 'USE_AS_IS'
  status VARCHAR(50) NOT NULL DEFAULT 'OPEN', -- 'DRAFT', 'OPEN', 'RESOLVED', 'CLOSED'
  scrap_journal_id UUID REFERENCES journals(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_certificates_of_analysis (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  coa_number VARCHAR(50) NOT NULL,
  lot_id UUID NOT NULL REFERENCES quality_inspection_lots(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  issue_date DATE NOT NULL,
  certified_by VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ISSUED', -- 'DRAFT', 'ISSUED', 'VOID'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qm_plans_org ON quality_inspection_plans(organization_id);
CREATE INDEX IF NOT EXISTS idx_qm_lots_org ON quality_inspection_lots(organization_id);
CREATE INDEX IF NOT EXISTS idx_qm_lots_item ON quality_inspection_lots(item_id);
CREATE INDEX IF NOT EXISTS idx_qm_ncr_org ON quality_non_conformance_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_qm_coa_org ON quality_certificates_of_analysis(organization_id);
