-- 036: SUP price score can be derived from PO prices vs the 12-month market price for the same items.
ALTER TABLE sup_scorecards ADD COLUMN IF NOT EXISTS price_index NUMERIC(12,4);
