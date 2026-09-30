# ADR-004 — Bank reconciliation sign-off with an explained difference
Status: accepted • 1 October 2026

## Decision
Sign-off is computed from the ledger: the GL balance, outstanding items and cleared lines. The user who imported the statement cannot sign it off (SoD). A non-zero unreconciled difference is allowed only with mandatory sign-off notes. The difference is stored in `bank_reconciliations.unreconciled_difference` and in the audit log. No journal is posted automatically: bank charges and adjustments go through normal journals. Automatic matching (`BANK-AUTOMATCH`, tier A2) only links a line when there is a unique exact amount within the date tolerance. It never signs off.
