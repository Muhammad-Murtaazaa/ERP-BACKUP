-- 029: Lending & servicing (LND) — customer instalment financing (e.g. HVAC units on instalments).
-- Amortisation schedule generated at disbursement; repayments allocated interest-first, oldest
-- instalment first; disbursement and each repayment post exactly once (source keys).
CREATE TABLE IF NOT EXISTS lnd_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    party_id UUID NOT NULL REFERENCES parties(id),
    purpose TEXT,
    principal NUMERIC(24,8) NOT NULL CHECK (principal > 0),
    annual_rate NUMERIC(7,4) NOT NULL CHECK (annual_rate >= 0 AND annual_rate <= 100),
    term_months INT NOT NULL CHECK (term_months BETWEEN 1 AND 360),
    method VARCHAR(16) NOT NULL DEFAULT 'ANNUITY' CHECK (method IN ('ANNUITY','EQUAL_PRINCIPAL')),
    application_date DATE NOT NULL,
    disbursement_date DATE,
    first_due_date DATE,
    outstanding_principal NUMERIC(24,8) NOT NULL DEFAULT 0,
    disbursement_journal_id UUID REFERENCES journals(id),
    submitted_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    decision_note TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','ACTIVE','CLOSED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lnd_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    loan_id UUID NOT NULL REFERENCES lnd_loans(id),
    seq INT NOT NULL,
    due_date DATE NOT NULL,
    principal NUMERIC(24,8) NOT NULL,
    interest NUMERIC(24,8) NOT NULL,
    paid_principal NUMERIC(24,8) NOT NULL DEFAULT 0,
    paid_interest NUMERIC(24,8) NOT NULL DEFAULT 0,
    CONSTRAINT uq_lnd_seq UNIQUE (loan_id, seq),
    CONSTRAINT ck_lnd_paid CHECK (paid_principal <= principal AND paid_interest <= interest)
);

CREATE TABLE IF NOT EXISTS lnd_repayments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    loan_id UUID NOT NULL REFERENCES lnd_loans(id),
    payment_date DATE NOT NULL,
    amount NUMERIC(24,8) NOT NULL CHECK (amount > 0),
    interest_part NUMERIC(24,8) NOT NULL,
    principal_part NUMERIC(24,8) NOT NULL,
    reference VARCHAR(64) NOT NULL,
    journal_id UUID REFERENCES journals(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lnd_repay_ref UNIQUE (loan_id, reference)
);
