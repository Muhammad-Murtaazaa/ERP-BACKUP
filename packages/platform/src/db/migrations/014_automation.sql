-- 014: Internal automation engine (AUTOMATION-AND-AI.md). Deterministic rules only, no external providers.
-- Rules run on a schedule; every occurrence is uniquely keyed (at-least-once trigger dedupe), attempts are
-- leased and retried with bounded backoff, exhausted runs dead-letter to an alert for the rule owner.

CREATE TABLE IF NOT EXISTS automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    job_type VARCHAR(40) NOT NULL CHECK (job_type IN (
      'REORDER_ALERTS','AR_DUNNING','AP_DUE_PROPOSALS','RECURRING_JOURNALS','BANK_AUTO_MATCH','STOCK_GL_RECON',
      'PM_WORK_ORDERS','DEPRECIATION_DUE','POS_SHIFT_MONITOR','APPROVAL_AGING','PERIOD_CLOSE_REMINDER')),
    -- Autonomy tier (A0 read/alert, A2 bounded reversible non-financial, A3 policy-bound posting). A4 is never automated.
    tier VARCHAR(2) NOT NULL DEFAULT 'A0' CHECK (tier IN ('A0','A1','A2','A3')),
    schedule_kind VARCHAR(16) NOT NULL DEFAULT 'DAILY' CHECK (schedule_kind IN ('INTERVAL','DAILY','MONTHLY')),
    interval_minutes INT CHECK (interval_minutes IS NULL OR interval_minutes BETWEEN 5 AND 10080),
    run_at_local TIME NOT NULL DEFAULT '06:00',
    day_of_month INT CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28),
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    paused BOOLEAN NOT NULL DEFAULT false,
    version INT NOT NULL DEFAULT 1,
    max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    owner_role VARCHAR(40) NOT NULL DEFAULT 'CONTROLLER',
    last_run_at TIMESTAMPTZ,
    last_status VARCHAR(16),
    next_run_at TIMESTAMPTZ,
    -- Occurrence awaiting a backoff retry (so the retry reuses the same run / attempt counter).
    pending_occurrence VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id),
    CONSTRAINT uq_automation_rule_code UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_due ON automation_rules(next_run_at) WHERE is_active AND NOT paused;

CREATE TABLE IF NOT EXISTS automation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    rule_version INT NOT NULL,
    occurrence_key VARCHAR(80) NOT NULL,
    trigger VARCHAR(16) NOT NULL CHECK (trigger IN ('SCHEDULE','MANUAL')),
    triggered_by UUID REFERENCES users(id),
    status VARCHAR(16) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','DEAD')),
    attempts INT NOT NULL DEFAULT 1,
    lease_until TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    summary JSONB,
    error TEXT,
    CONSTRAINT uq_automation_occurrence UNIQUE (rule_id, occurrence_key)
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_rule ON automation_runs(rule_id, started_at DESC);

-- Notification inbox. One OPEN alert per dedupe_key: re-detection refreshes it instead of spamming.
CREATE TABLE IF NOT EXISTS automation_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES automation_rules(id) ON DELETE SET NULL,
    run_id UUID REFERENCES automation_runs(id) ON DELETE SET NULL,
    category VARCHAR(32) NOT NULL,
    severity VARCHAR(10) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','CRITICAL')),
    title VARCHAR(255) NOT NULL,
    body TEXT,
    entity_type VARCHAR(40),
    entity_id UUID,
    dedupe_key VARCHAR(160) NOT NULL,
    data JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
    occurrences INT NOT NULL DEFAULT 1,
    assigned_role VARCHAR(40),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_alert_open ON automation_alerts(organization_id, dedupe_key) WHERE status <> 'RESOLVED';
CREATE INDEX IF NOT EXISTS idx_automation_alerts_status ON automation_alerts(organization_id, status, last_seen_at DESC);

-- Recurring journal templates (tier A3: posts only once approved by someone other than the author).
CREATE TABLE IF NOT EXISTS recurring_journal_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    lines JSONB NOT NULL,
    total_amount NUMERIC(24,8) NOT NULL CHECK (total_amount > 0),
    day_of_month INT NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
    start_date DATE NOT NULL,
    end_date DATE,
    next_run_date DATE NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ENDED')),
    max_amount NUMERIC(24,8),
    created_by UUID NOT NULL REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    last_journal_id UUID REFERENCES journals(id),
    occurrences_posted INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_recurring_code UNIQUE (organization_id, code),
    CONSTRAINT ck_recurring_sod CHECK (approved_by IS NULL OR approved_by <> created_by),
    CONSTRAINT ck_recurring_dates CHECK (end_date IS NULL OR end_date >= start_date)
);
