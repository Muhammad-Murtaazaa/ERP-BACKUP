-- 044: mid-term plan changes. Upgrades bill the prorated price difference for the rest of the current
-- period at once (an UPGRADE billing period; deferred for quarterly/annual plans); downgrades are
-- queued and take effect from the next bill date (no credit notes).
ALTER TABLE com_billing_periods ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'REGULAR' CHECK (kind IN ('REGULAR','UPGRADE'));
ALTER TABLE com_billing_periods DROP CONSTRAINT IF EXISTS uq_com_period;
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_period_regular ON com_billing_periods (subscription_id, period_start) WHERE kind = 'REGULAR';
CREATE UNIQUE INDEX IF NOT EXISTS uq_com_period_upgrade ON com_billing_periods (subscription_id, period_start) WHERE kind = 'UPGRADE';
ALTER TABLE com_subscriptions ADD COLUMN IF NOT EXISTS pending_plan_id UUID REFERENCES com_plans(id);
CREATE TABLE IF NOT EXISTS com_plan_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES com_subscriptions(id),
    from_plan_id UUID NOT NULL REFERENCES com_plans(id),
    to_plan_id UUID NOT NULL REFERENCES com_plans(id),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('UPGRADE','DOWNGRADE','LATERAL')),
    effective_date DATE NOT NULL,
    prorated_net NUMERIC(24,8) NOT NULL DEFAULT 0,
    billing_period_id UUID REFERENCES com_billing_periods(id),
    applied BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_com_plan_changes_sub ON com_plan_changes (subscription_id, created_at);
