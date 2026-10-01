-- 042: receiving inspection lots carry the supplier (from the purchase order) so the SUP scorecard
-- can derive the quality score from usage decisions.
ALTER TABLE quality_inspection_lots ADD COLUMN IF NOT EXISTS party_id UUID REFERENCES parties(id);
ALTER TABLE quality_inspection_lots ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id);
CREATE INDEX IF NOT EXISTS idx_qm_lots_party ON quality_inspection_lots (organization_id, party_id, inspected_at);
ALTER TABLE sup_scorecards ADD COLUMN IF NOT EXISTS inspected_lots INT;
ALTER TABLE sup_scorecards ADD COLUMN IF NOT EXISTS rejected_lots INT;
