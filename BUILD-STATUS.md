# Omnysync ERP Build Status

## Current Milestone
**M0, M1, M2, M3, M4, M5, M6, M7 + POS, M8 & M9: Foundation + Financial Ledger + Trading + Treasury/FX + Workforce/Payroll + Manufacturing + Projects/BOQ + Fixed Assets & POS + Quality Management (QM) + Plant Maintenance & Equipment Engineering (PM) (VERIFIED)**

## Implemented Capabilities
- **Exact Decimal Arithmetic Core** (`@omnysync/financial-engine`): Exact decimal computation using `decimal.js` with working monetary scale (24,8), rate scale (24,12), explicit half-up rounding, and string serialization across API boundaries.
- **Four-Level Chart of Accounts (COA)** (`@omnysync/financial-engine`, `@omnysync/platform`): Strict 4-level hierarchy (L1 Statement Class > L2 Group > L3 Subgroup > L4 Leaf Account). Only Level 4 accounts accept financial postings. Complete standard enterprise COA template including trading, payroll, inventory adjustments, manufacturing WIP/scrap, project milestone & retention accounts, fixed assets (`121001`, `121002`, `521004`), and equipment repairs & maintenance (`521005 Equipment Maintenance & Repairs Expense`).
- **Fiscal Calendar & Period Management**: 12-month calendar with posting guards (`OPEN`, `SOFT_CLOSED`, `HARD_CLOSED`).
- **PostgreSQL Database & Migration Runner** (`@omnysync/platform`): Migration runner supporting embedded PGlite (WASM PostgreSQL 16) and standard PostgreSQL (`pg` pool). Migrations 001 through 014.
- **Authentication & RBAC**: Scrypt password hashing, tamper-proof HMAC session tokens, and role-based permissions (`ADMIN`, `CONTROLLER`, `ACCOUNTANT`, `CASHIER`, `SALES_OPERATOR`, `INVENTORY_MANAGER`, `HR_MANAGER`, `PRODUCTION_MANAGER`, `WAREHOUSE_OPERATOR`, `PROJECT_MANAGER`, `QUALITY_MANAGER`, `MAINTENANCE_ENGINEER`, `AUDITOR`, `VIEWER`).
- **Journal Lifecycle & Posting Engine**: Draft -> Submit -> Approve -> Post -> General Ledger -> Trial Balance -> Linked Reversals with double-entry balancing ($\sum\text{Debits} = \sum\text{Credits}$).
- **M2 Trading Masters & Workflows**: Parties subledger, catalog items, Order-to-Cash (Sales Orders, Stock Fulfillment, AR Invoicing, COGS GL vouchers), Procure-to-Pay (Purchase Orders, GRN Stock Receipts, GRNI Liability Accruals, AP Supplier Bills), Customer Receipts & Supplier Disbursements with open-item allocation.
- **M3 Treasury, Bank Reconciliation & Multi-Currency FX Engine**: Electronic bank statement ingestion, two-way matching, automated direct bank charge journals, statement sign-off lock, spot FX rates table (24,12), realized FX gain/loss on settlements, unrealized FX gain/loss balance sheet revaluations, and client onboarding industry provisioning wizard.
- **M4 Workforce & Human Resource Management (HRM)**: Departments with cost centers, designations, employee directory, salary structures with earnings components (Basic, HRA, Utility, Medical), progressive statutory income tax slabs, statutory EOBI pension deductions, monthly payroll batch execution, automated balanced GL accruals (`Dr Salaries Expense 512001 / Cr Tax Withholding 212002 / Cr EOBI Payable 212003 / Cr Net Salaries Payable 211004`), and bank disbursement vouchers (`Dr Net Salaries Payable / Cr Operating Bank`).
- **M5 Multi-Warehouse, Bins & Logistics** (`@omnysync/platform`, `@omnysync/contracts`): Multi-warehouse facility modeling, storage zones, bin locations, lot & batch tracking, serial numbers, and two-stage stock transfer orders.
- **M5 Physical Inventory Cycle Counting & Stock Adjustments** (`@omnysync/financial-engine`): Counting sheets with stock snapshots, item-level variance calculation, and automated balanced GL adjustment vouchers (`Dr Inventory Adjustments 511002 / Cr Inventory Asset 113001`).
- **M5 Bills of Materials (BOM) & Manufacturing Assembly** (`@omnysync/financial-engine`): Multi-level BOM definitions with batch yield quantities, component ratios, scrap percentages, Work Order lifecycle, raw material issuance, WIP consumption, and finished goods assembly completion GL settlement vouchers.
- **M6 Projects, Cost Centers & Bill of Quantities (BOQ)** (`@omnysync/platform`, `@omnysync/financial-engine`, `@omnysync/contracts`): Cost Centers hierarchy, project portfolio, WBS nodes, BOQ items, Interim Payment Certificates (IPC) with over-certification guard, retention withholding, and automated balanced GL progress invoice vouchers.
- **M7 Fixed Assets, Asset Register & Automated Depreciation Engine** (`@omnysync/platform`, `@omnysync/financial-engine`, `@omnysync/contracts`): Asset Categories with useful life & salvage %, Fixed Asset Register, straight-line & double-declining balance schedules, periodic depreciation GL postings, and asset disposal/derecognition with exact gain/loss calculations.
- **Dedicated Point of Sale (POS) Module** (`@omnysync/platform`, `@omnysync/financial-engine`, `@omnysync/contracts`): POS registers, Cashier Shift Sessions with float, rapid order processing, instant inventory decrements, and shift close drawer reconciliation with automated balanced GL session vouchers.
- **M8 Quality Management & Inspection Lots (QM)** (`@omnysync/platform`, `@omnysync/financial-engine`, `@omnysync/contracts`):
  - Quality Inspection Plans (`quality_inspection_plans`, `quality_inspection_plan_params`) with numeric tolerance intervals (`min_tolerance`, `max_tolerance`), text inspections, and mandatory evaluation rules.
  - Quality Inspection Lots (`quality_inspection_lots`, `quality_inspection_results`) with automated pass/fail tolerance evaluation (`ACCEPTED` vs `REJECTED`).
  - Non-Conformance Reports (NCR) (`quality_non_conformance_reports`) with root cause analysis, CAPA corrective actions, and defective material write-off GL vouchers (`Dr Manufacturing Scrap 511003 / Cr Inventory 113002`).
  - Certificates of Analysis (CoA) (`quality_certificates_of_analysis`) with customer assignment and certified quality officer sign-off.
- **M9 Plant Maintenance & Equipment Engineering (PM)** (`@omnysync/platform`, `@omnysync/financial-engine`, `@omnysync/contracts`):
  - Machinery & Equipment Register (`maintenance_equipment`) with category, criticality ratings, location, operating hours, and optional fixed asset binding.
  - Preventive Maintenance Schedules (`pm_schedules`) with recurring frequency intervals and automatic next due date calculation.
  - Maintenance Work Orders (`maintenance_work_orders`, `maint_order_parts`, `maint_order_labor`) with spare parts consumption, technician labor costing, equipment downtime logging, and automated balanced GL settlement vouchers (`Dr Equipment Maintenance Expense 521005 / Cr Spare Parts Inventory 113002 / Cr Accrued Labor Salaries 211004`).
  - Equipment Calibration Register (`equipment_calibrations`) with testing lab certificate tracking, pass/fail calibration ratings, and expiry date monitoring.
- **Accessible React Web UI** (`@omnysync/web`, `@omnysync/ui`): Built with Polaris-inspired design system tokens, featuring Quality Management & Inspection Lots View, Plant Maintenance & Equipment Engineering View, Fixed Assets & Depreciation View, POS Terminal & Cashier Shift View, Projects & BOQ View, Warehouses & Logistics View, Manufacturing View, Workforce & HRM View, Payroll View, Dashboard, Parties View, Catalog View, Sales Orders View, AR Invoices View, Purchase Orders View, AP Supplier Bills View, Payments & Allocations View, Bank Statement Reconciliation View, FX Rates View, Onboarding Wizard, COA Hierarchy Tree, Journal Vouchers, Trial Balance, Fiscal Periods, and Audit Trail.

## Overnight enhancement pass (branch `feat/overnight-enhancements`, 2026-10-01)
- **Core correctness and security audit:**
  - PGlite transaction mutex, AsyncLocalStorage routing and savepoints.
  - Session secret, timing-safe login and throttling, and server-side permission checks on every route.
  - Posting only through `postJournal`: idempotent sourceKey, period row lock, leaf accounts.
  - Fixes across trading, treasury, HRM, manufacturing, assets, projects, QM and PM (see commits).
- **Big-box POS** (migration 013, `routes/pos.ts`, `financial-engine/src/retail.ts`, `apps/web/src/pos/*`):
  - Keyboard-first terminal with an F-key shortcut map and cheat sheet.
  - Scanner input: barcodes and PLUs, plus weight and price-embedded labels.
  - Promotions rules engine: BOGO, mix-and-match, bundle, tiered pricing, coupons.
  - Split and multi-tender payments with cash rounding.
  - Hold and recall carts; returns and exchanges with or without a receipt.
  - Loyalty points and gift cards / store credit.
  - Manager-PIN approvals with lockout.
  - Shift open and close with blind denomination counts; X/Z reports with variance.
  - Cash in/out and no-sale drawer, with an audit trail.
  - Offline cart and outbox with idempotent replay.
  - Real-time stock deduction and auto-posting (ADR-003).
- **Internal automation** (migration 014, `apps/api/src/automation/*`, Automation & Alerts view):
  - 11 deterministic rules, DST-safe schedules and occurrence-keyed dedupe.
  - Bounded retries with dead-letter alerts to the rule owner; pause kill switch.
  - Alerts inbox with dedupe and auto-resolve.
  - Recurring journals with maker-checker approval (ADR-011).
- **UI (Workman patterns and design-system.md):**
  - Drawer replaces 45 modals and Combobox replaces 60 selects across 19 views.
  - Collapsible 240/64 shell with a skip link and focus-visible states.
  - Tables: sticky header, loading, empty and error states; error states wired in 24 views.
  - Decimal-safe display: 107 `parseFloat` uses replaced.
  - `Column.accessor` is now rendered; 52 columns previously showed raw fields.

## Verified Capabilities (actual command output, 2026-10-01 PKT)
- `npx vitest run`: **11 files, 165 tests, all passing** (6.2 s).

  | Test file | Tests | Covers |
  | --- | --- | --- |
  | `packages/financial-engine/test/financial-engine.test.ts` | 41 | |
  | `packages/financial-engine/test/retail.test.ts` | 26 | Scan parsing, promotions, tender settlement, rounding, refunds, loyalty |
  | `packages/financial-engine/test/calendar.test.ts` | 3 | |
  | `packages/platform/test/platform.test.ts` | 3 | |
  | `apps/api/test/api.test.ts` | 17 | |
  | `apps/api/test/pos.test.ts` | 24 | Rounding, split tender over/under, return of discounted items, void after payment, concurrent stock and shift open, PIN lockout, offline replay dedupe |
  | `apps/api/test/automation.test.ts` | 11 | |
  | `apps/api/test/automation-schedule.test.ts` | 7 | DST gap and fall-back |
  | `apps/api/test/controls.test.ts` | 11 | SoD, double and concurrent post, period guard, idempotency, tenant isolation, GET purity |
  | `apps/web/test/pos-cart.test.ts` | 18 | |
  | `apps/web/test/format.test.ts` | 4 | |

- `npx tsc --noEmit -p .` and `npm run lint`: 0 errors.
- `npm run build`: all 6 workspaces build. The web bundle builds in 3.0 s, with a chunk-size warning of 680 kB (173 kB gzip).
- Screenshots:
  - `/workspace/erp-screens/before` (25)
  - `/workspace/erp-screens/after` (36)
  - `/workspace/erp-screens/pos` (17)

## Blockers
- None for the build.
- `npm audit` still reports 5 advisories, all in dev tooling: vite, esbuild, vite-node, vitest and @vitest/mocker. Every fix requires a major upgrade (vitest 5, vite 8). This was deferred to avoid destabilising the toolchain overnight. None of these packages ship in the production API or web bundle.

## Last Actual Checks
- `npx vitest run`: 11 files, 165 passed.
- `npm run build`: exit 0.
- `npm run lint`: exit 0.

## Not built (MODULE-CATALOG gap, see /workspace/erp-overnight-REPORT.md)
- CRM, DOC, FLT, GRC, LND, LOG, EPM, TAL, BI, SRV, COM, SUP and TIM have no implementation.
- ADM, CFG, TAX, WMS and AUT are partial.

## Next Roadmap Milestones
- **Milestone 10**: Logistics, Freight Management & Landed Cost Tracking.
- **Milestone 11**: Multi-Company Consolidation, Inter-Company Transactions & Elimination Journals.
