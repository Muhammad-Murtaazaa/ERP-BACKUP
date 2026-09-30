# Omnysync ERP Build Status

## Current Milestone
**M0, M1, M2, M3, M4, M5 & M6: Foundation + Financial Ledger + Trading Workflows + Treasury/FX + Workforce/Payroll + Advanced Inventory/Manufacturing + Projects, Cost Centers, BOQ & Progress Invoicing (VERIFIED)**

## Implemented Capabilities
- **Exact Decimal Arithmetic Core** (`@omnysync/financial-engine`): Exact decimal computation using `decimal.js` with working monetary scale (24,8), rate scale (24,12), explicit half-up rounding, and string serialization across API boundaries.
- **Four-Level Chart of Accounts (COA)** (`@omnysync/financial-engine`, `@omnysync/platform`): Strict 4-level hierarchy (L1 Statement Class > L2 Group > L3 Subgroup > L4 Leaf Account). Only Level 4 accounts accept financial postings. Complete standard enterprise COA template including trading, payroll, inventory adjustments, manufacturing WIP/scrap, and project milestone & retention accounts (`112003 Project Retention Receivable`, `211005 Subcontractor Retention Payable`, `411003 Project Milestone & Contract Revenue`, `511004 Project Direct Material & Labor Cost`).
- **Fiscal Calendar & Period Management**: 12-month calendar with posting guards (`OPEN`, `SOFT_CLOSED`, `HARD_CLOSED`).
- **PostgreSQL Database & Migration Runner** (`@omnysync/platform`): Migration runner supporting embedded PGlite (WASM PostgreSQL 16) and standard PostgreSQL (`pg` pool). Migrations 001, 002, 003, 004, 005, and 006.
- **Authentication & RBAC**: Scrypt password hashing, tamper-proof HMAC session tokens, and role-based permissions (`ADMIN`, `CONTROLLER`, `ACCOUNTANT`, `SALES_OPERATOR`, `INVENTORY_MANAGER`, `HR_MANAGER`, `PRODUCTION_MANAGER`, `WAREHOUSE_OPERATOR`, `PROJECT_MANAGER`, `AUDITOR`, `VIEWER`).
- **Journal Lifecycle & Posting Engine**: Draft -> Submit -> Approve -> Post -> General Ledger -> Trial Balance -> Linked Reversals with double-entry balancing ($\sum\text{Debits} = \sum\text{Credits}$).
- **M2 Trading Masters & Workflows**: Parties subledger, catalog items, Order-to-Cash (Sales Orders, Stock Fulfillment, AR Invoicing, COGS GL vouchers), Procure-to-Pay (Purchase Orders, GRN Stock Receipts, GRNI Liability Accruals, AP Supplier Bills), Customer Receipts & Supplier Disbursements with open-item allocation.
- **M3 Treasury, Bank Reconciliation & Multi-Currency FX Engine**: Electronic bank statement ingestion, two-way matching, automated direct bank charge journals, statement sign-off lock, spot FX rates table (24,12), realized FX gain/loss on settlements, unrealized FX gain/loss balance sheet revaluations, and client onboarding industry provisioning wizard.
- **M4 Workforce & Human Resource Management (HRM)**: Departments with cost centers, designations, employee directory, salary structures with earnings components (Basic, HRA, Utility, Medical), progressive statutory income tax slabs, statutory EOBI pension deductions, monthly payroll batch execution, automated balanced GL accruals (`Dr Salaries Expense 512001 / Cr Tax Withholding 212002 / Cr EOBI Payable 212003 / Cr Net Salaries Payable 211004`), and bank disbursement vouchers (`Dr Net Salaries Payable / Cr Operating Bank`).
- **M5 Multi-Warehouse, Bins & Logistics** (`@omnysync/platform`, `@omnysync/contracts`):
  - Multi-warehouse facility modeling (`warehouses`), storage zones (`warehouse_zones`), and bin locations (`warehouse_bins`).
  - Lot & batch tracking (`item_lots`) with manufacture/expiry dates and statuses (`AVAILABLE`, `QUARANTINE`, `EXPIRED`, `DEPLETED`).
  - Unique serial number tracking (`item_serials`) with warehouse and bin location binding.
  - Inter-facility stock transfer orders (`stock_transfers`, `stock_transfer_items`) with two-stage dispatch (`ship` -> `IN_TRANSIT`) and receipt (`receive` -> `COMPLETED`).
- **M5 Physical Inventory Cycle Counting & Stock Adjustments** (`@omnysync/financial-engine`):
  - Physical inventory counting sheets with system stock snapshot.
  - Item-level and aggregate variance calculation.
  - Automated balanced General Ledger adjustment voucher generation (`Dr Inventory Adjustments & Shrinkage 511002 / Cr Inventory Asset 113001` for shortage, or vice versa for surplus).
- **M5 Bills of Materials (BOM) & Manufacturing Assembly** (`@omnysync/financial-engine`):
  - Multi-level BOM definitions with batch yield quantities, raw material component ratios, and scrap percentages.
  - Shop floor Work Order lifecycle (`PLANNED` -> `RELEASED` -> `IN_PROGRESS` -> `COMPLETED` -> `CLOSED`).
  - Raw material issuance and WIP consumption recording with exact decimal cost tracking.
  - Finished goods assembly completion and automated GL settlement voucher (`Dr Finished Goods Inventory 113004 / Dr Manufacturing Scrap 511003 / Cr Work In Progress 113003`).
- **M6 Projects, Cost Centers & Bill of Quantities (BOQ)** (`@omnysync/platform`, `@omnysync/financial-engine`, `@omnysync/contracts`):
  - Cost Centers hierarchy (`cost_centers`) with operational, project, and overhead scopes.
  - Project portfolio master (`projects`) with contract value, budget cost, retention percentage, customer linkage, and lifecycle tracking.
  - Work Breakdown Structure (`project_wbs_nodes`) hierarchy with progress percentages and budget tracking.
  - Bill of Quantities (`bill_of_quantities`, `boq_items`) with contract quantities, unit rate analysis, and cumulative certified measurement tracking.
  - Interim Payment Certificates (`progress_certificates`, `progress_certificate_items`) with over-certification guard, retention money withholding (`gross * retention_pct / 100`), and net certified billable calculation.
  - Automated balanced General Ledger progress invoice voucher (`Dr Trade AR Control 112001 (Net) + Dr Project Retention Receivable 112003 (Retention) = Cr Project Milestone & Contract Revenue 411003 (Gross)`).
- **Accessible React Web UI** (`@omnysync/web`, `@omnysync/ui`): Built with Polaris-inspired design system tokens, featuring Projects, Cost Centers & BOQ View, Warehouses & Logistics View, Manufacturing & Work Orders View, Workforce & HRM View, Payroll & Disbursals View, Dashboard, Parties View, Catalog & Valuation View, Sales Orders View, AR Invoices View, Purchase Orders View, AP Supplier Bills View, Payments & Allocations View, Bank Statement Reconciliation View, FX Rates View, Onboarding Wizard, COA Hierarchy Tree, Journal Vouchers, Trial Balance, Fiscal Periods, and Audit Trail.

## Verified Capabilities
- **46 automated tests passing with 100% success rate**:
  - `packages/financial-engine/test/financial-engine.test.ts` (30 tests: exact money arithmetic, 4-level COA rules, period guards, double-entry balancing, linked reversals, trial balance, bank statement matching, reconciliation math, multi-currency conversion, realized & unrealized FX gain/loss, payroll gross-to-net & tax slabs, BOM explosion with scrap percentage, work order costing & completion journals, inventory count variance calculation & shrinkage GL adjustment journals, BOQ cumulative measurement & retention math, over-certification validation, and progress invoice GL balancing).
  - `packages/platform/test/platform.test.ts` (3 tests: SQL migrations 001-006, synthetic seeds, scrypt auth, database constraints).
  - `apps/api/test/api.test.ts` (13 tests: full journal lifecycle, period posting guards, party & catalog management, Order-to-Cash, Procure-to-Pay, Treasury allocations, bank reconciliation, FX revaluation, onboarding templates, monthly payroll run to bank disbursal, inter-warehouse transfer dispatch/receipt, physical cycle count GL adjustment, BOM creation, work order material consumption and assembly completion GL voucher, Cost Center creation, Project & WBS definition, BOQ items, over-certification rejection, IPC certification, progress invoice GL voucher generation, and balanced trial balance).
- **TypeScript strict compilation and production build**: All monorepo packages build cleanly with 0 type errors.

## Blockers
- None.

## Last Actual Checks
- Vitest test suite: `npx vitest run` (3 test files, 46 tests passed in 38.09s).
- Full monorepo build: `npm run build` (all packages built and `@omnysync/web` bundle compiled in 53.42s).

## Next Executable Tasks (Milestone 7: Fixed Assets, Depreciation Engine & Capitalization)
1. Fixed Asset Register (`fixed_assets`, `asset_categories`, `asset_locations`): Asset acquisition, serial/tag tracking, custodian assignment, and cost capitalization.
2. Automated Depreciation Engine: Straight-line, declining balance, and units-of-production depreciation calculations with monthly scheduled GL vouchers (`Dr Depreciation Expense 521004 / Cr Accumulated Depreciation 121002`).
3. Asset Disposal & Revaluation: Asset retirement, write-off, disposal gain/loss accounting, and linked General Ledger settlement.
