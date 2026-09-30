-- Migration: 010_plant_maintenance.sql
-- Description: Equipment Register, Preventive Maintenance Schedules, Maintenance Work Orders, Spare Parts Consumption, Labor, and Calibrations

CREATE TABLE IF NOT EXISTS maintenance_equipment (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  equipment_code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  fixed_asset_id UUID REFERENCES fixed_assets(id) ON DELETE SET NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'MACHINERY', -- 'MACHINERY', 'VEHICLE', 'ELECTRICAL', 'HVAC'
  location VARCHAR(255),
  criticality VARCHAR(50) NOT NULL DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  status VARCHAR(50) NOT NULL DEFAULT 'OPERATIONAL', -- 'OPERATIONAL', 'UNDER_MAINTENANCE', 'DECOMMISSIONED'
  operating_hours NUMERIC(24, 8) NOT NULL DEFAULT 0.0,
  serial_number VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pm_schedules (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES maintenance_equipment(id) ON DELETE CASCADE,
  schedule_name VARCHAR(255) NOT NULL,
  frequency_type VARCHAR(50) NOT NULL DEFAULT 'TIME_BASED_DAYS', -- 'TIME_BASED_DAYS', 'METER_USAGE_HOURS'
  frequency_interval NUMERIC(24, 8) NOT NULL,
  last_performed_date DATE,
  next_due_date DATE NOT NULL,
  checklist_json JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'PAUSED'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maintenance_work_orders (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  work_order_number VARCHAR(50) NOT NULL,
  equipment_id UUID NOT NULL REFERENCES maintenance_equipment(id) ON DELETE CASCADE,
  pm_schedule_id UUID REFERENCES pm_schedules(id) ON DELETE SET NULL,
  order_type VARCHAR(50) NOT NULL DEFAULT 'PREVENTIVE', -- 'PREVENTIVE', 'CORRECTIVE', 'BREAKDOWN', 'CALIBRATION'
  priority VARCHAR(50) NOT NULL DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  description TEXT NOT NULL,
  failure_code VARCHAR(100),
  start_date DATE,
  completion_date DATE,
  total_parts_cost NUMERIC(24, 8) NOT NULL DEFAULT 0.0,
  total_labor_cost NUMERIC(24, 8) NOT NULL DEFAULT 0.0,
  total_cost NUMERIC(24, 8) NOT NULL DEFAULT 0.0,
  downtime_hours NUMERIC(24, 8) NOT NULL DEFAULT 0.0,
  settlement_journal_id UUID REFERENCES journals(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maint_order_parts (
  id UUID PRIMARY KEY,
  work_order_id UUID NOT NULL REFERENCES maintenance_work_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity NUMERIC(24, 8) NOT NULL,
  unit_cost NUMERIC(24, 8) NOT NULL,
  total_cost NUMERIC(24, 8) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maint_order_labor (
  id UUID PRIMARY KEY,
  work_order_id UUID NOT NULL REFERENCES maintenance_work_orders(id) ON DELETE CASCADE,
  technician_name VARCHAR(255) NOT NULL,
  labor_hours NUMERIC(24, 8) NOT NULL,
  hourly_rate NUMERIC(24, 8) NOT NULL,
  total_cost NUMERIC(24, 8) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS equipment_calibrations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES maintenance_equipment(id) ON DELETE CASCADE,
  calibration_certificate_no VARCHAR(100) NOT NULL,
  calibration_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  calibration_agency VARCHAR(255) NOT NULL,
  result VARCHAR(50) NOT NULL DEFAULT 'PASS', -- 'PASS', 'FAIL'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_maint_equip_org ON maintenance_equipment(organization_id);
CREATE INDEX IF NOT EXISTS idx_maint_wo_org ON maintenance_work_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_maint_wo_equip ON maintenance_work_orders(equipment_id);
CREATE INDEX IF NOT EXISTS idx_pm_sched_equip ON pm_schedules(equipment_id);
CREATE INDEX IF NOT EXISTS idx_calib_equip ON equipment_calibrations(equipment_id);
