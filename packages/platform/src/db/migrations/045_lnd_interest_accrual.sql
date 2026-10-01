-- 045: optional accrual-basis loan interest (setting lnd.interest_basis = ACCRUAL). Interest falling due
-- is accrued DR 112005 / CR 411006 once per instalment; collections then credit 112005 instead of income.
INSERT INTO accounts (id, organization_id, legal_entity_id, code, name, level, parent_id, statement_class, normal_balance, is_active, posting_allowed, control_type)
SELECT gen_random_uuid(), le.organization_id, le.id, '112005', 'Accrued Interest Receivable (Customer Financing)', 4, p.id, 'ASSET', 'DEBIT', true, true, 'GENERAL'
FROM legal_entities le JOIN accounts p ON p.legal_entity_id = le.id AND p.code = '1120'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE legal_entity_id = le.id AND code = '112005');
ALTER TABLE lnd_schedule ADD COLUMN IF NOT EXISTS interest_accrued_on DATE;
ALTER TABLE lnd_schedule ADD COLUMN IF NOT EXISTS accrual_journal_id UUID REFERENCES journals(id);
