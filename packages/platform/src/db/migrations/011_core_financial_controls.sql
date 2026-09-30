-- ============================================================================
-- 011: Core financial controls (overnight hardening)
--  * collision-free document numbering (document_sequences)
--  * journal source idempotency key (source_key) with unique scope
--  * DB-enforced immutability of posted journals / lines and stock movements
--  * deferred journal balance constraint (application checks are not sufficient,
--    FINANCIAL-CONTROLS.md "Posting engine")
--  * command idempotency keys (logic.md step 4)
-- Append-only; no existing data is rewritten.
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_sequences (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  prefix VARCHAR(32) NOT NULL,
  period_key VARCHAR(8) NOT NULL,
  last_value BIGINT NOT NULL CHECK (last_value > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, prefix, period_key)
);

ALTER TABLE journals ADD COLUMN IF NOT EXISTS source_key VARCHAR(200);
CREATE UNIQUE INDEX IF NOT EXISTS uq_journals_source_key ON journals(organization_id, source_key) WHERE source_key IS NOT NULL;
-- A journal can be reversed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_journals_single_reversal ON journals(reversal_of_journal_id) WHERE reversal_of_journal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  idem_key VARCHAR(128) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(512) NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
  response_status INT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id, idem_key)
);

-- ---------------------------------------------------------------------------
-- Posted journal immutability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION omny_guard_posted_journal() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'POSTED_FACT_IMMUTABLE: posted journal % cannot be deleted', OLD.journal_number USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('POSTED', 'REVERSED') THEN
    IF NEW.posting_date IS DISTINCT FROM OLD.posting_date
       OR NEW.document_date IS DISTINCT FROM OLD.document_date
       OR NEW.total_base_debit IS DISTINCT FROM OLD.total_base_debit
       OR NEW.total_base_credit IS DISTINCT FROM OLD.total_base_credit
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
       OR NEW.journal_number IS DISTINCT FROM OLD.journal_number
       OR NEW.accounting_purpose IS DISTINCT FROM OLD.accounting_purpose
       OR NEW.base_currency IS DISTINCT FROM OLD.base_currency
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.source_key IS DISTINCT FROM OLD.source_key
       OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
       OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.reversal_of_journal_id IS DISTINCT FROM OLD.reversal_of_journal_id THEN
      RAISE EXCEPTION 'POSTED_FACT_IMMUTABLE: posted journal % cannot be edited; use a linked reversal', OLD.journal_number USING ERRCODE = 'P0001';
    END IF;
    -- Only permitted change: POSTED -> REVERSED with the reversal link set once.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (OLD.status = 'POSTED' AND NEW.status = 'REVERSED' AND NEW.reversed_by_journal_id IS NOT NULL) THEN
        RAISE EXCEPTION 'POSTED_FACT_IMMUTABLE: invalid status change % -> % on posted journal', OLD.status, NEW.status USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF OLD.reversed_by_journal_id IS NOT NULL AND NEW.reversed_by_journal_id IS DISTINCT FROM OLD.reversed_by_journal_id THEN
      RAISE EXCEPTION 'POSTED_FACT_IMMUTABLE: reversal link is permanent' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_posted_journal ON journals;
CREATE TRIGGER trg_guard_posted_journal BEFORE UPDATE OR DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION omny_guard_posted_journal();

CREATE OR REPLACE FUNCTION omny_guard_posted_journal_lines() RETURNS trigger AS $$
DECLARE
  parent_status VARCHAR(20);
  jid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    jid := OLD.journal_id;
  ELSE
    jid := NEW.journal_id;
  END IF;
  SELECT status INTO parent_status FROM journals WHERE id = jid;
  IF TG_OP IN ('UPDATE', 'DELETE') AND parent_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'POSTED_FACT_IMMUTABLE: lines of a posted journal cannot be changed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_posted_journal_lines ON journal_lines;
CREATE TRIGGER trg_guard_posted_journal_lines BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION omny_guard_posted_journal_lines();

-- Deferred balance check: at COMMIT every POSTED journal touched in the transaction
-- must have >= 2 lines, base debits = base credits and header totals = line totals.
CREATE OR REPLACE FUNCTION omny_check_journal_balance() RETURNS trigger AS $$
DECLARE
  jid UUID;
  j RECORD;
  sum_d NUMERIC;
  sum_c NUMERIC;
  n INT;
BEGIN
  IF TG_TABLE_NAME = 'journals' THEN
    jid := NEW.id;
  ELSE
    jid := NEW.journal_id;
  END IF;
  SELECT * INTO j FROM journals WHERE id = jid;
  IF j IS NULL OR j.status NOT IN ('POSTED', 'REVERSED') THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(base_debit), 0), COALESCE(SUM(base_credit), 0), COUNT(*)
    INTO sum_d, sum_c, n FROM journal_lines WHERE journal_id = jid;
  IF n < 2 THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: posted journal % has fewer than 2 lines', j.journal_number USING ERRCODE = 'P0001';
  END IF;
  IF sum_d <> sum_c THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: posted journal % debits % <> credits %', j.journal_number, sum_d, sum_c USING ERRCODE = 'P0001';
  END IF;
  IF sum_d <> j.total_base_debit OR sum_c <> j.total_base_credit THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: posted journal % header totals do not match lines', j.journal_number USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_journal_balance_hdr ON journals;
CREATE CONSTRAINT TRIGGER trg_check_journal_balance_hdr AFTER INSERT OR UPDATE ON journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION omny_check_journal_balance();

DROP TRIGGER IF EXISTS trg_check_journal_balance_lines ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_check_journal_balance_lines AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION omny_check_journal_balance();

-- ---------------------------------------------------------------------------
-- Stock movement facts are append-only (corrections are new movements).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION omny_guard_stock_movements() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'POSTED_FACT_IMMUTABLE: stock movements are append-only; post a correcting movement' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_stock_movements ON stock_movements;
CREATE TRIGGER trg_guard_stock_movements BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION omny_guard_stock_movements();

-- Audit trail is append-only.
CREATE OR REPLACE FUNCTION omny_guard_audit_logs() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: audit records cannot be modified or deleted' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_audit_logs ON audit_logs;
CREATE TRIGGER trg_guard_audit_logs BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION omny_guard_audit_logs();

CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(organization_id, item_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(organization_id, created_at DESC);
