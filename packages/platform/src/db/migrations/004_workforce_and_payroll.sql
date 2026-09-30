-- 004_workforce_and_payroll.sql: Milestone 4 Human Resource Management & Payroll Core

-- 1. Ensure L4 accounts for payroll liabilities exist under legal entities
INSERT INTO accounts (id, organization_id, legal_entity_id, code, name, level, parent_id, statement_class, normal_balance, is_active, posting_allowed, control_type)
SELECT 
  gen_random_uuid(),
  le.organization_id,
  le.id,
  '211004',
  'Salaries Payable',
  4,
  p.id,
  'LIABILITY',
  'CREDIT',
  true,
  true,
  'GENERAL'
FROM legal_entities le
JOIN accounts p ON p.legal_entity_id = le.id AND p.code = '2110'
WHERE NOT EXISTS (
  SELECT 1 FROM accounts WHERE legal_entity_id = le.id AND code = '211004'
);

INSERT INTO accounts (id, organization_id, legal_entity_id, code, name, level, parent_id, statement_class, normal_balance, is_active, posting_allowed, control_type)
SELECT 
  gen_random_uuid(),
  le.organization_id,
  le.id,
  '212003',
  'EOBI & Social Security Payable',
  4,
  p.id,
  'LIABILITY',
  'CREDIT',
  true,
  true,
  'TAX_PAYABLE'
FROM legal_entities le
JOIN accounts p ON p.legal_entity_id = le.id AND p.code = '2120'
WHERE NOT EXISTS (
  SELECT 1 FROM accounts WHERE legal_entity_id = le.id AND code = '212003'
);

INSERT INTO accounts (id, organization_id, legal_entity_id, code, name, level, parent_id, statement_class, normal_balance, is_active, posting_allowed, control_type)
SELECT 
  gen_random_uuid(),
  le.organization_id,
  le.id,
  '212004',
  'Provident Fund Payable',
  4,
  p.id,
  'LIABILITY',
  'CREDIT',
  true,
  true,
  'TAX_PAYABLE'
FROM legal_entities le
JOIN accounts p ON p.legal_entity_id = le.id AND p.code = '2120'
WHERE NOT EXISTS (
  SELECT 1 FROM accounts WHERE legal_entity_id = le.id AND code = '212004'
);

-- 2. Departments
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  cost_center_code VARCHAR(64),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_department_code UNIQUE (legal_entity_id, code)
);

CREATE INDEX IF NOT EXISTS idx_departments_entity ON departments(legal_entity_id);

-- 3. Designations
CREATE TABLE IF NOT EXISTS designations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_designation_code UNIQUE (legal_entity_id, code)
);

CREATE INDEX IF NOT EXISTS idx_designations_entity ON designations(legal_entity_id);

-- 4. Employees
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  employee_number VARCHAR(32) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  national_id VARCHAR(50),
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  designation_id UUID REFERENCES designations(id) ON DELETE SET NULL,
  employment_type VARCHAR(32) NOT NULL DEFAULT 'FULL_TIME',
  joining_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  bank_name VARCHAR(100),
  bank_account_number VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_employee_number UNIQUE (legal_entity_id, employee_number)
);

CREATE INDEX IF NOT EXISTS idx_employees_entity_status ON employees(legal_entity_id, status);

-- 5. Salary Structures
CREATE TABLE IF NOT EXISTS salary_structures (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  basic_salary NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  house_rent_allowance NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (house_rent_allowance >= 0),
  utility_allowance NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (utility_allowance >= 0),
  medical_allowance NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (medical_allowance >= 0),
  other_allowances NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0),
  gross_salary NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (gross_salary >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_salary_structures_entity ON salary_structures(legal_entity_id);

-- 6. Employee Salary Assignments
CREATE TABLE IF NOT EXISTS employee_salary_assignments (
  id UUID PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  salary_structure_id UUID NOT NULL REFERENCES salary_structures(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_salaries_emp ON employee_salary_assignments(employee_id, is_current);

-- 7. Payroll Runs
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES fiscal_periods(id) ON DELETE RESTRICT,
  run_number VARCHAR(64) NOT NULL,
  month_year VARCHAR(7) NOT NULL,
  total_gross NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_gross >= 0),
  total_tax NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_tax >= 0),
  total_eobi NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_eobi >= 0),
  total_provident_fund NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_provident_fund >= 0),
  total_other_deductions NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_other_deductions >= 0),
  total_deductions NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_deductions >= 0),
  total_net NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_net >= 0),
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  posted_journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT,
  disbursement_journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_payroll_run_number UNIQUE (legal_entity_id, run_number)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_query ON payroll_runs(legal_entity_id, month_year, status);

-- 8. Payroll Run Items
CREATE TABLE IF NOT EXISTS payroll_run_items (
  id UUID PRIMARY KEY,
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  basic_salary NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  allowances_total NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (allowances_total >= 0),
  gross_salary NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (gross_salary >= 0),
  tax_deduction NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (tax_deduction >= 0),
  eobi_deduction NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (eobi_deduction >= 0),
  provident_fund_deduction NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (provident_fund_deduction >= 0),
  other_deductions NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  total_deductions NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_deductions >= 0),
  net_salary NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (net_salary >= 0),
  payment_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  CONSTRAINT uq_payroll_item_emp UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_run_items(payroll_run_id);
