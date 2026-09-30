-- Omnysync Database Schema Migration 003: Treasury, FX Engine, Bank Reconciliation & Onboarding
-- Multi-currency exchange rates, Bank Statements, Statement Lines, Reconciliations, and Onboarding Profiles

-- 1. Currency Exchange Rates (Multi-Currency & FX)
CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate NUMERIC(24, 12) NOT NULL CHECK (rate > 0),
  effective_date DATE NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'MANUAL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_fx_rate UNIQUE (organization_id, from_currency, to_currency, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup ON exchange_rates(organization_id, from_currency, to_currency, effective_date);

-- 2. Bank Statements (Treasury)
CREATE TABLE IF NOT EXISTS bank_statements (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
  bank_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  statement_reference VARCHAR(64) NOT NULL,
  statement_date DATE NOT NULL,
  opening_balance NUMERIC(24, 8) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(24, 8) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'RECONCILING', 'RECONCILED')),
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_bank_stmt_ref UNIQUE (legal_entity_id, bank_account_id, statement_reference)
);

CREATE INDEX IF NOT EXISTS idx_bank_stmts_acc ON bank_statements(legal_entity_id, bank_account_id, statement_date);

-- 3. Bank Statement Lines
CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id UUID PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  line_number INT NOT NULL,
  transaction_date DATE NOT NULL,
  value_date DATE,
  amount NUMERIC(24, 8) NOT NULL,
  reference VARCHAR(255),
  description TEXT,
  is_matched BOOLEAN NOT NULL DEFAULT FALSE,
  matched_journal_line_id UUID REFERENCES journal_lines(id) ON DELETE SET NULL,
  CONSTRAINT uq_stmt_line UNIQUE (statement_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_stmt_lines_matched ON bank_statement_lines(statement_id, is_matched);

-- 4. Bank Reconciliations
CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id UUID PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  reconciled_date DATE NOT NULL,
  statement_closing_balance NUMERIC(24, 8) NOT NULL,
  gl_closing_balance NUMERIC(24, 8) NOT NULL,
  unreconciled_difference NUMERIC(24, 8) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'LOCKED')),
  reconciled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Onboarding Profiles & Templates
CREATE TABLE IF NOT EXISTS onboarding_profiles (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  industry_template VARCHAR(64) NOT NULL CHECK (industry_template IN ('WHOLESALE_DISTRIBUTION', 'SERVICES_CONSULTING', 'LIGHT_MANUFACTURING', 'CUSTOM')),
  setup_step VARCHAR(32) NOT NULL DEFAULT 'ORGANIZATION',
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
