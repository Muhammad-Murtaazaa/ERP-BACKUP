-- 047_workman_hrm_enhancements.sql
-- Workman Services HRM Features: Staff Advances (Hisaab), Geofence Attendance, Shifts, Leave Allocations, and Expense Claims

-- 1. Ensure L4 accounts for Staff Advances and Employee Expenses exist
INSERT INTO accounts (id, organization_id, legal_entity_id, code, name, level, parent_id, statement_class, normal_balance, is_active, posting_allowed, control_type)
SELECT 
  gen_random_uuid(),
  le.organization_id,
  le.id,
  '112006',
  'Staff Advances & Employee Floats',
  4,
  p.id,
  'ASSET',
  'DEBIT',
  true,
  true,
  'GENERAL'
FROM legal_entities le
JOIN accounts p ON p.legal_entity_id = le.id AND p.code = '1120'
WHERE NOT EXISTS (
  SELECT 1 FROM accounts WHERE legal_entity_id = le.id AND code = '112006'
);

INSERT INTO accounts (id, organization_id, legal_entity_id, code, name, level, parent_id, statement_class, normal_balance, is_active, posting_allowed, control_type)
SELECT 
  gen_random_uuid(),
  le.organization_id,
  le.id,
  '521014',
  'Employee Travel & Field Expenses',
  4,
  p.id,
  'EXPENSE',
  'DEBIT',
  true,
  true,
  'GENERAL'
FROM legal_entities le
JOIN accounts p ON p.legal_entity_id = le.id AND p.code = '5210'
WHERE NOT EXISTS (
  SELECT 1 FROM accounts WHERE legal_entity_id = le.id AND code = '521014'
);

-- 2. Staff Advances (Hisaab & Floats)
CREATE TABLE IF NOT EXISTS hrm_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  number VARCHAR(32) NOT NULL,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  advance_type VARCHAR(32) NOT NULL DEFAULT 'CASH' CHECK (advance_type IN ('CASH', 'TRAVEL', 'PARTS_FLOAT', 'EMERGENCY_LOAN')),
  amount NUMERIC(24, 8) NOT NULL CHECK (amount > 0),
  purpose TEXT NOT NULL,
  repayment_months INT NOT NULL DEFAULT 1 CHECK (repayment_months >= 1),
  monthly_deduction NUMERIC(24, 8) NOT NULL CHECK (monthly_deduction > 0),
  recovered_amount NUMERIC(24, 8) NOT NULL DEFAULT 0.00000000,
  balance_amount NUMERIC(24, 8) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'DISBURSED', 'RECOVERED', 'REJECTED')),
  disbursement_journal_id UUID REFERENCES journals(id),
  disbursed_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_hrm_adv_number UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS idx_hrm_adv_emp ON hrm_advances(organization_id, employee_id, status);

CREATE TABLE IF NOT EXISTS hrm_advance_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id UUID NOT NULL REFERENCES hrm_advances(id) ON DELETE CASCADE,
  installment_number INT NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(24, 8) NOT NULL,
  recovered_amount NUMERIC(24, 8) NOT NULL DEFAULT 0.00000000,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DEDUCTED_IN_PAYROLL', 'PAID_CASH')),
  payroll_run_id UUID,
  recovered_at TIMESTAMPTZ,
  CONSTRAINT uq_hrm_adv_inst UNIQUE (advance_id, installment_number)
);

-- 3. Geofence Zones
CREATE TABLE IF NOT EXISTS hrm_geofence_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,
  radius_meters NUMERIC(10, 2) NOT NULL DEFAULT 100.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_hrm_geofence_code UNIQUE (organization_id, code)
);

-- 4. Work Shifts
CREATE TABLE IF NOT EXISTS hrm_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  start_time VARCHAR(5) NOT NULL,
  end_time VARCHAR(5) NOT NULL,
  grace_period_minutes INT NOT NULL DEFAULT 15,
  half_day_hours NUMERIC(4, 2) NOT NULL DEFAULT 4.50,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_hrm_shift_code UNIQUE (organization_id, code)
);

-- 5. Daily Attendance Logs with Geofence Verification
CREATE TABLE IF NOT EXISTS hrm_attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  shift_id UUID REFERENCES hrm_shifts(id),
  check_in_time TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  check_in_lat NUMERIC(10, 7),
  check_in_lng NUMERIC(10, 7),
  geofence_zone_id UUID REFERENCES hrm_geofence_zones(id),
  geofence_status VARCHAR(32) NOT NULL DEFAULT 'INSIDE_GEOFENCE' CHECK (geofence_status IN ('INSIDE_GEOFENCE', 'OUTSIDE_GEOFENCE', 'REMOTE_APPROVED')),
  verification_method VARCHAR(32) NOT NULL DEFAULT 'GEOFENCE' CHECK (verification_method IN ('GEOFENCE', 'FACE_VERIFIED', 'BIOMETRIC', 'MANUAL')),
  status VARCHAR(32) NOT NULL DEFAULT 'PRESENT' CHECK (status IN ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE')),
  late_minutes INT NOT NULL DEFAULT 0,
  total_hours NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_hrm_emp_date UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_hrm_att_date ON hrm_attendance_logs(organization_id, work_date, status);

-- 6. Leave Types & Allocations
CREATE TABLE IF NOT EXISTS hrm_leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  annual_quota INT NOT NULL DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_hrm_leave_type_code UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS hrm_leave_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES hrm_leave_types(id) ON DELETE CASCADE,
  year INT NOT NULL,
  allocated_days NUMERIC(5, 2) NOT NULL,
  used_days NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  remaining_days NUMERIC(5, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_hrm_emp_leave_alloc UNIQUE (employee_id, leave_type_id, year)
);

-- 7. Staff & Technician Expense Claims
CREATE TABLE IF NOT EXISTS hrm_expense_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  number VARCHAR(32) NOT NULL,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  claim_date DATE NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'TRAVEL' CHECK (category IN ('TRAVEL', 'FUEL', 'TOOLS', 'PARTS', 'FOOD', 'OTHER')),
  amount NUMERIC(24, 8) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  receipt_reference VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'SETTLED_CASH', 'SETTLED_PAYROLL')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  settlement_journal_id UUID REFERENCES journals(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_hrm_exp_number UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS idx_hrm_exp_emp ON hrm_expense_claims(organization_id, employee_id, status);
