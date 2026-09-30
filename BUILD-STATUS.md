# Omnysync ERP Build Status

## Current Milestone
**M0, M1, M2, M3, M4, M5, M6 & M7 + POS: Foundation + Financial Ledger + Trading + Treasury/FX + Workforce/Payroll + Manufacturing + Projects/BOQ + Fixed Assets & Automated Depreciation + Dedicated Point of Sale (POS) (VERIFIED)**

## Implemented Capabilities
- **Exact Decimal Arithmetic Core** (`@omnysync/financial-engine`): Exact decimal computation using `decimal.js` with working monetary scale (24,8), rate scale (24,12), explicit half-up rounding, and string serialization across API boundaries.
- **Four-Level Chart of Accounts (COA)** (`@omnysync/financial-engine`, `@omnysync/platform`): Strict 4-level hierarchy (L1 Statement Class > L2 Group > L3 Subgroup > L4 Leaf Account). Only Level 4 accounts accept financial postings. Complete standard enterprise COA template including trading, payroll, inventory adjustments, manufacturing WIP/scrap, project milestone & retention accounts, and fixed asset & depreciation accounts (`121001 Office Equipment Cost`, `121002 Accumulated Depreciation - Office Equipment`, `521004 Depreciation Expense`).
- **Fiscal Calendar & Period Management**: 12-month calendar with posting guards (`OPEN`, `SOFT_CLOSED`, `HARD_CLOSED`).
- **PostgreSQL Database & Migration Runner** (`@omnysync/platform`): Migration runner supporting embedded PGlite (WASM PostgreSQL 16) and standard PostgreSQL (`pg` pool). Migrations 001 through 008.
- **Authentication & RBAC**: Scrypt password hashing, tamper-proof HMAC session tokens, and role-based permissions (`ADMIN`, `CONTROLLER`, `ACCOUNTANT`, `CASHIER`, `SALES_OPERATOR`, `INVENTORY_MANAGER`, `HR_MANAGER`, `PRODUCTION_MANAGER`, `WAREHOUSE_OPERATOR`, `PROJECT_MANAGER`, `AUDITOR`, `VIEWER`).
- **Journal Lifecycle & Posting Engine**: Draft -> Submit -> Approve -> Post -> General Ledger -> Trial Balance -> Linked Reversals with double-entry balancing ($\sum\text{Debits} = \sum\text{Credits}$).
- **M2 Trading Masters & Workflows**: Parties subledger, catalog items, Order-to-Cash (Sales Orders, Stock Fulfillment, AR Invoicing, COGS GL vouchers), Procure-to-Pay (Purchase Orders, GRN Stock Receipts, GRNI Liability Accruals, AP Supplier Bills), Customer Receipts & Supplier Disbursements with open-item allocation.
- **M3 Treasury, Bank Reconciliation & Multi-Currency FX Engine**: Electronic bank statement ingestion, two-way matching, automated direct bank charge journals, statement sign-off lock, spot FX rates table (24,12), realized FX gain/loss on settlements, unrealized FX gain/loss balance sheet revaluations, and client onboarding industry provisioning wizard.
- **M4 Workforce & Human Resource Management (HRM)**: Departments with cost centers, designations, employee directory, salary structures with earnings components (Basic, HRA, Utility, Medical), progressive statutory income tax slabs, statutory EOBI pension deductions, monthly payroll batch execution, automated balanced GL accruals (`Dr Salaries Expense 512001 / Cr Tax Withholding 212002 / Cr EOBI Payable 212003 / Cr Net Salaries Payable 211004`), and bank disbursement vouchers (`Dr Net Salaries Payable / Cr Operating Bank`).
- **M5 Multi-Warehouse, Bins & Logistics** (`@omnysync/platform`, `@omnysync/contracts`):
  - Multi-warehouse facility modeling (`warehouses`), storage zones (`warehouse_zones`), and bin locations (`warehouse_bins`).
  - Lot & batch tracking (`item_lots`) with manufacture/expiry dates and statuses (`AVAILABLE`, `QUARANTINE`, `EXPIRED`, `DEPLETED`).
  - Unique serial number tracking (`item_serials`) with warehouse and bin location binding.
  - Inter-facility stock transfer orders (`stock_transfers`, `stock_transfer_items`) with two-stage dispatch (`ship` -> `IN_TRANSIT`) and receipt (`receive` -> `COMPLETED`).
- **M5 Physical Inventory Cycle Counting & Stock Adjustments** (`@omnysync/financial-engine`): Physical inventory counting sheets with system stock snapshot, item-level/aggregate variance calculation, and automated balanced GL adjustment voucher (`Dr Inventory Adjustments & Shrinkage 511002 / Cr Inventory Asset 113001`).
- **M5 Bills of Materials (BOM) & Manufacturing Assembly** (`@omnysync/financial-engine`): Multi-level BOM definitions with batch yield quantities, raw material component ratios, scrap percentages, Work Order lifecycle (`PLANNED` -> `RELEASED` -> `IN_PROGRESS` -> `COMPLETED` -> `CLOSED`), raw material issuance and WIP consumption, and finished goods assembly completion GL settlement voucher (`Dr Finished Goods Inventory 113004 / Dr Manufacturing Scrap 511003 / Cr Work In Progress 113003`).
- **M6 Projects, Cost Centers & Bill of Quantities (BOQ)** (`@omnysync/platform`, `@omnysync/financial-engine`, `@omnysync/contracts`): Cost Centers hierarchy (`cost_centers`), Project portfolio master (`projects`), Work Breakdown Structure (`project_wbs_nodes`), Bill of Quantities (`bill_of_quantities`, `boq_items`), Interim Payment Certificates (`progress_certificates`, `progress_certificate_items`) with over-certification guard, retention money withholding, and automated balanced GL progress invoice voucher (`Dr Trade AR Control 112001 (Net) + Dr Project Retention Receivable 112003 (Retention) = Cr Project Milestone & Contract Revenue 411003 (Gross)`).
- **M7 Fixed Assets, Asset Register & Automated Depreciation Engine** (`@omnysync/platform`, `@omnysync/financial-engine`, `@omnysync/contracts`):
  - Asset Categories (`asset_categories`) with default useful life, salvage value percentage, straight-line/declining balance methods, and default GL accounts.
  - Fixed Asset Register (`fixed_assets`) with asset tag/serial numbers, location, custodian assignment, acquisition cost, and net book value tracking.
  - Automated Periodic Depreciation Engine (`asset_depreciation_entries`) with straight-line & double-declining balance schedules and automated balanced GL posting (`Dr Depreciation Expense 521004 / Cr Accumulated Depreciation 121002`).
  - Asset Disposals & Derecognition (`FixedAssetsEngine.generateDisposalJournal`) with retirement write-off, disposal gain/loss settlement (`Dr Bank / Dr AccumDeprec / Dr Loss or Cr Gain / Cr AssetCost`), and balance sheet derecognition.
- **Dedicated Point of Sale (POS) Module** (`@omnysync/platform`, `@omnysync/financial-engine`, `@omnysync/contracts`):
  - POS Registers (`pos_registers`) with warehouse binding and dedicated cash drawer & card clearing account routing.
  - Cashier Shift Sessions (`pos_sessions`) with opening float, ongoing cash & card sales accumulation, and expected drawer calculation (`float + cash_sales`).
  - High-Speed POS Order Processing (`pos_orders`, `pos_order_lines`) with fast item lookup, item line totals, order discounts, VAT/sales tax calculation, cash tender with change due, and instant inventory stock decrement.
  - Shift Close Drawer Reconciliation (`POSEngine.reconcileSession`) with physical cash count, cash shortage/overage detection, and consolidated balanced General Ledger session voucher posting (`Dr Cash (actual) + Dr Shortage or Cr Surplus + Dr Card Clearing = Cr Product Sales + Cr Output Sales Tax`).
- **Accessible React Web UI** (`@omnysync/web`, `@omnysync/ui`): Built with Polaris-inspired design system tokens, featuring Fixed Assets & Depreciation View, POS Terminal & Cashier Shift View, Projects & BOQ View, Warehouses & Logistics View, Manufacturing View, Workforce & HRM View, Payroll View, Dashboard, Parties View, Catalog View, Sales Orders View, AR Invoices View, Purchase Orders View, AP Supplier Bills View, Payments & Allocations View, Bank Statement Reconciliation View, FX Rates View, Onboarding Wizard, COA Hierarchy Tree, Journal Vouchers, Trial Balance, Fiscal Periods, and Audit Trail.

## Verified Capabilities
- **54 automated tests passing with 100% success rate**:
  - `packages/financial-engine/test/financial-engine.test.ts` (36 tests: exact money arithmetic, 4-level COA rules, period guards, double-entry balancing, linked reversals, trial balance, bank statement matching, reconciliation math, multi-currency conversion, realized & unrealized FX gain/loss, payroll gross-to-net & tax slabs, BOM explosion with scrap percentage, work order costing & completion journals, inventory count variance calculation & shrinkage GL adjustment journals, BOQ cumulative measurement & retention math, over-certification validation, progress invoice GL balancing, straight-line & declining-balance depreciation calculation, asset disposal journal with gain/loss, POS cart line math & tax/discount calculation, and POS session drawer reconciliation & closing journal generation).
  - `packages/platform/test/platform.test.ts` (3 tests: SQL migrations 001-008, synthetic seeds, scrypt auth, database constraints).
  - `apps/api/test/api.test.ts` (15 tests: full journal lifecycle, period posting guards, party & catalog management, Order-to-Cash, Procure-to-Pay, Treasury allocations, bank reconciliation, FX revaluation, onboarding templates, monthly payroll run to bank disbursal, inter-warehouse transfer dispatch/receipt, physical cycle count GL adjustment, BOM creation, work order material consumption and assembly completion GL voucher, Cost Center creation, Project & WBS definition, BOQ items, over-certification rejection, IPC certification, progress invoice GL voucher generation, Fixed Asset category setup, asset registration, periodic depreciation GL voucher posting, asset disposal with gain, POS register setup, cashier shift opening with float, cash & card POS orders with instant stock movements, shift closing with drawer reconciliation, and balanced trial balance).
- **TypeScript strict compilation and production build**: All monorepo packages build cleanly with 0 type errors.

## Blockers
- None.

## Last Actual Checks
- Vitest test suite: `npx vitest run` (3 test files, 54 tests passed in 7.45s).
- Full monorepo build: `npm run build` (all packages built and `@omnysync/web` bundle compiled in 6.23s).

## Next Roadmap Milestones
- **Milestone 8**: Quality Management, Inspection Lot Engine, Certificate of Analysis (CoA) & Non-Conformance Reports (NCR).
- **Milestone 9**: Equipment Maintenance, Work Orders & Calibration Schedules.
