-- 038: COM revenue deferral. Quarterly / annual subscription invoices credit Deferred Revenue (211010);
-- the billed amount is allocated by days to calendar months and recognised month by month
-- (DR 211010 / CR 411007), once per schedule line.
CREATE TABLE IF NOT EXISTS com_revenue_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES com_subscriptions(id),
    billing_period_id UUID NOT NULL REFERENCES com_billing_periods(id),
    month_start DATE NOT NULL,
    recognize_on DATE NOT NULL,
    amount NUMERIC(24,8) NOT NULL CHECK (amount >= 0),
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RECOGNISED')),
    journal_id UUID REFERENCES journals(id),
    recognised_at TIMESTAMPTZ,
    CONSTRAINT uq_com_rev_line UNIQUE (billing_period_id, month_start)
);
CREATE INDEX IF NOT EXISTS idx_com_rev_due ON com_revenue_schedule (organization_id, status, recognize_on);
