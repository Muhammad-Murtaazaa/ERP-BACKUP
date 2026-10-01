-- 030: Governance, risk & compliance (GRC) — risk register with inherent/residual scoring,
-- controls with periodic tests (failed test -> deficient + remediation issue), incident log.
CREATE TABLE IF NOT EXISTS grc_risks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(16) NOT NULL CHECK (category IN ('OPERATIONAL','FINANCIAL','COMPLIANCE','SAFETY','IT','STRATEGIC')),
    owner VARCHAR(120),
    likelihood INT NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
    impact INT NOT NULL CHECK (impact BETWEEN 1 AND 5),
    residual_likelihood INT CHECK (residual_likelihood BETWEEN 1 AND 5),
    residual_impact INT CHECK (residual_impact BETWEEN 1 AND 5),
    treatment VARCHAR(10) NOT NULL DEFAULT 'MITIGATE' CHECK (treatment IN ('MITIGATE','ACCEPT','TRANSFER','AVOID')),
    review_date DATE,
    acceptance_note TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MITIGATING','ACCEPTED','CLOSED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_grc_risk_code UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS grc_controls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    risk_id UUID NOT NULL REFERENCES grc_risks(id),
    control_type VARCHAR(12) NOT NULL CHECK (control_type IN ('PREVENTIVE','DETECTIVE','CORRECTIVE')),
    frequency VARCHAR(10) NOT NULL CHECK (frequency IN ('MONTHLY','QUARTERLY','ANNUAL')),
    owner VARCHAR(120),
    procedure TEXT,
    last_tested_on DATE,
    last_result VARCHAR(4) CHECK (last_result IN ('PASS','FAIL')),
    next_test_due DATE,
    status VARCHAR(10) NOT NULL DEFAULT 'DESIGN' CHECK (status IN ('DESIGN','OPERATING','DEFICIENT','RETIRED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_grc_control_code UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS grc_control_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    control_id UUID NOT NULL REFERENCES grc_controls(id),
    test_date DATE NOT NULL,
    result VARCHAR(4) NOT NULL CHECK (result IN ('PASS','FAIL')),
    sample_size INT CHECK (sample_size IS NULL OR sample_size > 0),
    exceptions INT NOT NULL DEFAULT 0 CHECK (exceptions >= 0),
    evidence TEXT NOT NULL,
    tested_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grc_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    incident_type VARCHAR(16) NOT NULL DEFAULT 'OPERATIONAL' CHECK (incident_type IN ('SAFETY','ENVIRONMENTAL','DATA','FRAUD','OPERATIONAL','CONTROL_FAILURE')),
    occurred_on DATE NOT NULL,
    risk_id UUID REFERENCES grc_risks(id),
    control_id UUID REFERENCES grc_controls(id),
    description TEXT,
    root_cause TEXT,
    corrective_action TEXT,
    due_date DATE,
    status VARCHAR(14) NOT NULL DEFAULT 'REPORTED' CHECK (status IN ('REPORTED','INVESTIGATING','RESOLVED','CLOSED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
