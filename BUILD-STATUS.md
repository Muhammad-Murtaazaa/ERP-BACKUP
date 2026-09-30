# Omnysync ERP Build Status

## Current Milestone
**M0, M1, M2 & M3: Foundation + Financial Ledger + Trading Workflows + Treasury, Bank Reconciliation, Multi-Currency FX Engine & Onboarding Wizard (VERIFIED)**

## Implemented Capabilities
- **Exact Decimal Arithmetic Core** (`@omnysync/financial-engine`): Implemented exact decimal computation using `decimal.js` with working monetary scale (24,8), rate scale (24,12), explicit half-up rounding, and string serialization across API boundaries.
- **Four-Level Chart of Accounts (COA)** (`@omnysync/financial-engine`, `@omnysync/platform`): Strict 4-level hierarchy (L1 Statement Class > L2 Group > L3 Subgroup > L4 Leaf Account). Enforced invariant: only Level 4 accounts accept financial postings; Levels 1-3 strictly forbid posting. Included full standard enterprise COA template.
- **Fiscal Calendar & Period Management**: 12-month calendar with posting guards (`OPEN`, `SOFT_CLOSED`, `HARD_CLOSED`). Rejects postings in closed periods at the database and application levels.
- **PostgreSQL Database & Migration Runner** (`@omnysync/platform`): Migration runner supporting embedded PGlite (WebAssembly PostgreSQL 16 engine) and standard PostgreSQL (`pg` pool). Includes full schema constraints (`CHECK`, `UNIQUE`, `FOREIGN KEY` scopes).
- **Authentication & RBAC**: Scrypt password hashing, tamper-proof HMAC session tokens, and role-based permissions (`ADMIN`, `CONTROLLER`, `ACCOUNTANT`, `SALES_OPERATOR`, `INVENTORY_MANAGER`, `AUDITOR`, `VIEWER`).
- **Journal Lifecycle & Posting Engine**: Draft -> Submit -> Approve -> Post -> General Ledger -> Trial Balance -> Linked Reversals. Enforces strict double-entry balancing ($\sum\text{Debits} = \sum\text{Credits}$), revision locking, and audit trail creation.
- **Linked Reversals**: Generates exact opposite debits and credits on allowed reversal dates, maintaining original voucher linkage without modifying posted history.
- **Append-Only Audit Trail & Transactional Outbox**: Persistent audit logs for state changes and durable event emission.
- **M2 Trading Masters (Parties & Items)**:
  - Parties subledger (Customers, Vendors, Both) with NTN tax identifiers, credit exposure limits, and contact profiles.
  - Catalog Items (Inventory, Service, Non-Inventory) with UOMs, selling prices, standard costs, and GL account bindings.
- **M2 Order-to-Cash (Sales Orders & Invoicing)**:
  - Sales Orders (Draft -> Confirmed -> Fulfilled/Shipped).
  - Goods fulfillment triggering inventory decrement in `stock_movements` and automatic COGS General Ledger voucher (`Dr Cost of Goods Sold 511001 / Cr Inventory 113001`).
  - AR Invoicing with General Ledger posting (`Dr Trade AR Control 112001 / Cr Product Sales 411001`) and outstanding balance tracking.
- **M2 Procure-to-Pay (Purchase Orders & Supplier Bills)**:
  - Purchase Orders (Draft -> Approved -> Received).
  - Goods receipt (GRN) into inventory with automated GRNI liability accrual voucher (`Dr Inventory 113001 / Cr GRNI Liability 211002`).
  - AP Supplier Bills with General Ledger posting (`Dr GRNI Liability 211002 / Cr Trade AP Control 211001`) clearing accruals.
- **M2 Treasury & Open-Item Allocation**:
  - Customer Receipts (`Dr Operating Bank / Cr Trade AR Control`) with line-item allocation against open AR invoices (marking invoices `PAID` or `PARTIALLY_PAID`).
  - Supplier Disbursements (`Dr Trade AP Control / Cr Operating Bank`) with line-item allocation against open AP bills (marking bills `PAID` or `PARTIALLY_PAID`).
- **M3 Bank Statement Reconciliation Engine** (`@omnysync/financial-engine`, `@omnysync/platform`):
  - Ingestion of electronic bank statements with date, reference, description, amount, and running balance.
  - Two-way match algorithm matching statement lines to system ledger payments / journal entries.
  - Automated journal creation for direct bank charges / fees / interest during reconciliation.
  - Reconciliation sign-off and statement locking ensuring statement ending balance equals GL adjusted cash balance (unreconciled difference = $0.00$).
- **M3 Multi-Currency FX Engine** (`@omnysync/financial-engine`):
  - Daily spot exchange rate table with high-precision (24,12) scale and triangulated rate calculations.
  - Realized FX gain/loss calculation on settled AR/AP invoices against payment exchange rates.
  - Revaluation of open foreign-currency monetary assets/liabilities with automated unrealized FX gain/loss journal generation (`Dr Foreign Currency Bank / Cr Unrealized FX Gain/Loss`).
- **M3 Client Onboarding & Industry Template Provisioning**:
  - Guided setup wizard provisioning industry configurations (`WHOLESALE_DISTRIBUTION`, `SERVICES_CONSULTING`, `LIGHT_MANUFACTURING`, `RETAIL_POS`).
  - Automated industry-specific COA accounts, default tax codes, and operational preferences.
- **Accessible React Web UI** (`@omnysync/web`, `@omnysync/ui`): Built with design system tokens, featuring Dashboard, Parties View, Catalog & Valuation View, Sales Orders View, AR Invoices View, Purchase Orders View, AP Supplier Bills View, Payments & Allocations View, Bank Statement Reconciliation View, FX Exchange Rates View, Onboarding Wizard, COA Hierarchy Tree, Journal Vouchers, Trial Balance, Fiscal Periods, and Audit Trail.

## Verified Capabilities
- **34 automated tests passing with 100% success rate**:
  - `packages/financial-engine/test/financial-engine.test.ts` (21 tests: exact money arithmetic, 4-level COA rules, period guards, double-entry balancing, linked reversals, trial balance, bank statement matching, reconciliation math, multi-currency conversion, realized & unrealized FX gain/loss calculations).
  - `packages/platform/test/platform.test.ts` (3 tests: SQL migrations 001, 002 & 003, synthetic seeds, scrypt auth, database constraints).
  - `apps/api/test/api.test.ts` (10 tests: full E2E journal lifecycle, closed period rejection, unbalanced draft rejection, non-leaf posting rejection, party & catalog management, Order-to-Cash fulfillment & COGS GL posting, Procure-to-Pay GRN & GRNI clearing, customer receipts & supplier disbursements with open-item allocation, bank statement upload & two-way reconciliation with direct fee posting, FX spot rates & realized FX gain/loss, industry onboarding provisioning, reconciled trial balance).
- **TypeScript strict compilation and production build**: All monorepo packages (`contracts`, `financial-engine`, `platform`, `ui`, `api`, `web`) build cleanly with 0 type errors.

## Blockers
- None.

## Last Actual Checks
- Vitest test suite: `npx vitest run` (3 test files, 34 tests passed in 9.59s).
- Full monorepo build: `npm run build` (all packages built and `@omnysync/web` bundle compiled in 4.82s).

## Next Executable Tasks (Milestone 4: Workforce & Payroll Core)
1. Human Resource Management (HRM) data model: Departments, Designations, Cost Centers, Employee Master, Statutory Tax Profiles.
2. Salary Structures & Allowances: Basic pay, house rent, utility allowance, statutory tax deductions (withholding tax slabs), employee provident fund / EOBI deductions.
3. Monthly Payroll Processing Engine: Gross-to-net computation, automated multi-line payroll journal voucher generation (`Dr Salaries & Wages Expense / Cr Withholding Tax Payable / Cr EOBI Payable / Cr Net Salaries Payable`), and bank disbursement batching.
