-- 039: LND late fees. An instalment still unpaid after the grace period is charged one flat late
-- fee (lnd.late_fee_flat). Fees are collected first in repayment allocation and, like interest,
-- recognised as income when collected (cash basis, CR 411005).
ALTER TABLE lnd_schedule ADD COLUMN IF NOT EXISTS late_fee NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE lnd_schedule ADD COLUMN IF NOT EXISTS paid_late_fee NUMERIC(24,8) NOT NULL DEFAULT 0;
ALTER TABLE lnd_schedule ADD COLUMN IF NOT EXISTS late_fee_assessed_on DATE;
ALTER TABLE lnd_schedule DROP CONSTRAINT IF EXISTS ck_lnd_fee_paid;
ALTER TABLE lnd_schedule ADD CONSTRAINT ck_lnd_fee_paid CHECK (late_fee >= 0 AND paid_late_fee <= late_fee);
ALTER TABLE lnd_repayments ADD COLUMN IF NOT EXISTS fee_part NUMERIC(24,8) NOT NULL DEFAULT 0;
