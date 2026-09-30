# Omnysync Implementation Evidence

## Milestone 0 & Milestone 1 (Verified)
- **Exact Decimal Arithmetic**: Implemented in `@omnysync/financial-engine/src/money.ts` with working scale 24,8. Verified across 15 unit tests without floating point drift.
- **4-Level Chart of Accounts (COA)**: Implemented in `@omnysync/financial-engine/src/coa.ts` and `001_initial_schema.sql`. Posting allowed strictly on Level 4 leaf accounts; rejected on L1-L3.
- **Fiscal Periods**: 12 monthly periods seeded; posting rejected in closed periods.
- **Journal Lifecycle**: Draft -> Submit -> Approve -> Post -> Linked Reversal.
- **Trial Balance**: Reconciled debits and credits with zero net difference.
- **Audit Logs**: Persistent audit trail for all posting actions.

## Milestone 2: Integrated Trading Workflows (Verified)
- **Database Migration**: `packages/platform/src/db/migrations/002_trading_workflows.sql` applied cleanly on WASM PGlite and PostgreSQL.
- **Parties Master**: Customer & Vendor records with NTN tax IDs, credit exposure limits, and contact profiles.
- **Item Master & Inventory Valuation Subledger**: Tracked inventory vs. non-stock services, selling prices, unit costs, and on-hand quantity aggregation from `stock_movements`.
- **Order-to-Cash Workflow**:
  - Sales Order creation (`/api/sales/orders`) and confirmation.
  - Stock fulfillment decrementing on-hand inventory and automatically posting Cost of Goods Sold GL voucher (`Dr COGS 511001 / Cr Inventory 113001`).
  - Customer AR invoice posting to GL (`Dr Trade AR Control 112001 / Cr Product Sales 411001`).
  - Customer receipt payment with open-item allocation marking invoices `PAID` with zero remaining balance.
- **Procure-to-Pay Workflow**:
  - Purchase Order creation (`/api/procurement/orders`) and approval.
  - Goods receipt (GRN) into stock layer with automated GRNI liability accrual voucher (`Dr Inventory 113001 / Cr GRNI Liability 211002`).
  - AP supplier bill posting to GL (`Dr GRNI Liability 211002 / Cr Trade AP Control 211001`) clearing accruals.
  - Supplier disbursement payment with open-item allocation marking bills `PAID`.
- **General Ledger Reconciliation**: Trial Balance remains strictly balanced ($\sum\text{Debits} = \sum\text{Credits}$, net difference $0.00$) after completing full trading and payment cycles.

## Automated Test Summary
- **Test Command**: `npx vitest run`
- **Result**: 3 test files, 25 tests passed, 0 failures.
- **Build Command**: `npm run build`
- **Result**: All monorepo packages compiled cleanly. Web bundle generated in `apps/web/dist`.
