# Omnysync Implementation Plan

## Milestone 0: Reproducible Running Foundation (M0)
- **Goal**: Strict TypeScript workspace, environment validation, database migration runner, shared request validation, typed errors, correlation IDs, redacted logging, design token system, deterministic synthetic seed runner.
- **Requirement IDs**:
  - `PLT-001` (Installation / Multi-tenant scoping)
  - `PLT-002` (Legal entities & branches)
  - `PLT-003` (User memberships & role grants)
  - `PLT-004` (Permission evaluation engine)
  - `PLT-005` (Audit log recording)
  - `CFG-001` (Module manifest registry)
  - `ADM-005` (Deterministic synthetic seeds)

## Milestone 1: Organization & First Complete Financial Workflow (M1)
- **Goal**: Four-level COA, leaf-only posting, fiscal calendars/periods, exact money calculation, posting engine, journal lifecycle (Draft -> Submit -> Approve -> Post -> Ledger/Trial Balance -> Linked Reversal), source revision guard, period locks, immutable posted facts, transactional outbox, web UI.
- **Requirement IDs**:
  - `GL-001` (Four-level COA hierarchy & leaf-only enforcement)
  - `GL-002` (Fiscal calendar & period management: open, soft_close, hard_close)
  - `GL-003` (Manual journal entry draft, validation, balancing check)
  - `GL-004` (Journal approval & posting execution)
  - `GL-005` (Immutable posted journals & audit trail)
  - `GL-006` (Linked reversal journals)
  - `GL-007` (General ledger & Trial balance computation)
  - `GL-008` (Idempotent posting & revision concurrency control)
  - `TAX-001` (Tax accounts & baseline rates)

## Milestone 2: Integrated Trading Workflows (M2)
- **Goal**: Party & item masters, Sales order-to-cash, Procurement procure-to-pay, Inventory quantity/value subledgers, AR/AP control reconciliation.
- **Requirement IDs**:
  - `SAL-001`..`SAL-010` (Sales quotes, orders, fulfillments, invoicing)
  - `PUR-001`..`PUR-010` (Requisitions, purchase orders, receipts, matching)
  - `INV-001`..`INV-010` (Stock movements, valuation layers, adjustments)
  - `AR-001`..`AR-010` (Billing, customer open items, allocations)
  - `AP-001`..`AP-010` (Vendor bills, GRNI matching, disbursements)
  - `TRY-001`..`TRY-005` (Bank accounts, statements, reconciliations)

## Milestone 3+: Advanced Suite & Specialized Packs
- Modules: HR & Payroll, Projects & BOQ, Manufacturing & MRP, Fixed Assets, Advanced Analytics.
