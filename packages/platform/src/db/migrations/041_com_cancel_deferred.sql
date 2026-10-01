-- 041: cancelling a deferred-billing subscription releases its unearned schedule lines
-- (earned-to-date part → revenue; the rest → customer credit 211006 or forfeited to revenue).
ALTER TABLE com_revenue_schedule DROP CONSTRAINT IF EXISTS com_revenue_schedule_status_check;
ALTER TABLE com_revenue_schedule ADD CONSTRAINT com_revenue_schedule_status_check CHECK (status IN ('PENDING','RECOGNISED','RELEASED'));
ALTER TABLE com_revenue_schedule ADD COLUMN IF NOT EXISTS released_amount NUMERIC(24,8);
ALTER TABLE com_subscriptions ADD COLUMN IF NOT EXISTS unearned_treatment VARCHAR(12) CHECK (unearned_treatment IN ('REFUND','FORFEIT'));
