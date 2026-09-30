-- Omnysync Core Database Schema Migration 001
-- Strict constraints, audit, RLS, four-level COA, immutable posted journals

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1. Organizations & Tenancy
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(64) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS legal_entities (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(64) NOT NULL,
  functional_currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  tax_identifier VARCHAR(64),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_legal_entities_code UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(64) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_branches_code UNIQUE (legal_entity_id, code)
);

-- 2. Users, Memberships & Permissions
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  roles JSONB NOT NULL DEFAULT '["VIEWER"]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_user_org UNIQUE (user_id, organization_id)
);

-- 3. Four-Level Chart of Accounts (COA)
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE RESTRICT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  parent_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  level INT NOT NULL CHECK (level BETWEEN 1 AND 4),
  statement_class VARCHAR(32) NOT NULL CHECK (statement_class IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
  posting_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  control_type VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
  currency_restriction VARCHAR(3),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_account_code_scope UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounts_org_level ON accounts(organization_id, level);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);

-- 4. Fiscal Calendars and Periods
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  fiscal_year INT NOT NULL,
  period_number INT NOT NULL,
  period_name VARCHAR(64) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SOFT_CLOSED', 'HARD_CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_fiscal_period UNIQUE (legal_entity_id, fiscal_year, period_number)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_periods_dates ON fiscal_periods(legal_entity_id, start_date, end_date);

-- 5. Journals & Immutable Posting Facts
CREATE TABLE IF NOT EXISTS journals (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  journal_number VARCHAR(64) NOT NULL,
  posting_date DATE NOT NULL,
  document_date DATE NOT NULL,
  accounting_purpose VARCHAR(64) NOT NULL DEFAULT 'MANUAL_JOURNAL',
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED')),
  base_currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  total_base_debit NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_base_debit >= 0),
  total_base_credit NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (total_base_credit >= 0),
  description TEXT NOT NULL,
  source_type VARCHAR(64),
  source_id UUID,
  source_version INT NOT NULL DEFAULT 1,
  reversal_of_journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT,
  reversed_by_journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  posted_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ,
  revision INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_journal_number UNIQUE (legal_entity_id, journal_number)
);

CREATE INDEX IF NOT EXISTS idx_journals_query ON journals(organization_id, legal_entity_id, posting_date, status);
CREATE INDEX IF NOT EXISTS idx_journals_source ON journals(organization_id, legal_entity_id, source_type, source_id, accounting_purpose, source_version);

CREATE TABLE IF NOT EXISTS journal_lines (
  id UUID PRIMARY KEY,
  journal_id UUID NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  line_number INT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit_amount NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  fx_rate NUMERIC(24, 12) NOT NULL DEFAULT 1.0,
  base_debit NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (base_debit >= 0),
  base_credit NUMERIC(24, 8) NOT NULL DEFAULT 0 CHECK (base_credit >= 0),
  description TEXT,
  party_id UUID,
  dimension_branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  dimension_project_id UUID,
  dimension_cost_center_id UUID,
  CONSTRAINT uq_journal_line_num UNIQUE (journal_id, line_number),
  CONSTRAINT chk_not_both_debit_credit CHECK (NOT (base_debit > 0 AND base_credit > 0))
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON journal_lines(journal_id);

-- 6. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  user_id UUID,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  before_state JSONB,
  after_state JSONB,
  correlation_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_scope ON audit_logs(organization_id, entity_type, entity_id);

-- 7. Transactional Outbox
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED')),
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(status, created_at);
