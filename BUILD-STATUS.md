# Omnysync ERP Build Status

## Current Milestone
**M0, M1, M2, M3, M4, M5, M6, M7 + POS, M8 & M9: Foundation + Financial Ledger + Trading + Treasury/FX + Workforce/Payroll + Manufacturing + Projects/BOQ + Fixed Assets & POS + Quality Management (QM) + Plant Maintenance & Equipment Engineering (PM) (VERIFIED)**

## Implemented Capabilities
- **Exact Decimal Arithmetic Core** (`@omnysync/financial-engine`): Exact decimal computation using `decimal.js` with working monetary scale (24,8), rate scale (24,12), explicit half-up rounding, and string serialization across API boundaries.
- **Four-Level Chart of Accounts (COA)** (`@omnysync/financial-engine`, `@omnysync/platform`): Strict 4-level hierarchy (L1 Statement Class > L2 Group > L3 Subgroup > L4 Leaf Account). Only Level 4 accounts accept financial postings. Complete standard enterprise COA template including trading, payroll, inventory adjustments, manufacturing WIP/scrap, project milestone & retention accounts, fixed assets (`121001`, `121002`, `521004`), and equipment repairs & maintenance (`521005 Equipment Maintenance & Repairs Expense`).
- **Fiscal Calendar & Period Management**: 12-month calendar with posting guards (`OPEN`, `SOFT_CLOSED`, `HARD_CLOSED`).
- **PostgreSQL Database & Migration Runner** (`@omnysync/platform`): Migration runner supporting embedded PGlite (WASM PostgreSQL 16) and standard PostgreSQL (`pg` pool). Migrations 001 through 032.
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

## Overnight pass, round 2 (same branch, 2026-10-01 03:57–05:30 PKT)
Shared **resource kit** (`apps/api/src/lib/resource.ts`, ADR-012) and **ModuleWorkspace** UI (`apps/web/src/views/kit/ModuleWorkspace.tsx`). Every new module gets the same things: list/search/filter/paging, Drawer forms with Comboboxes, optimistic `revision` checks, state-machine commands with SoD, audit and outbox events, `requireModule` lifecycle guards, org-scoped refs (a foreign or missing ref returns 400 with `details.field`), and an idempotent seeder.

| Code | Module | Migration | Status | Built, and tested in `apps/api/test/*` |
| --- | --- | --- | --- | --- |
| ADM/CFG | Admin & Configuration | 015 | Built | Versioned settings with history and stale-version 409; module lifecycle (enabled/draining/read_only/disabled) |
| TAX | Tax Compliance | 016 | Built | Tax codes and rates by date, return periods, filing lock |
| WMS | Warehouse Execution | 017 | Built | Putaway/pick tasks, wave picking, bin capacity |
| AUT | Automation | 018 | Built | Event-triggered rules alongside scheduled rules; visual rule builder (Workflow Studio). Actions are ALERT/TASK only (ADR-013) |
| SRV | Field Service | 019 | Built | Cases, SLA business-hours clock, dispatch, work orders, parts issue with stock and COGS, billing, contracts/PM |
| CRM | CRM & Pipeline | 020 | Built | Leads, opportunities, kanban, win → SRV installation case, event rule |
| TIM | Time & Attendance | 021 | Built | Timesheets with overlap guard, overtime, approval SoD, period-guarded posting, leave |
| SUP | Supplier Management | 022 | Built | Onboarding, blocking (PO create refuses blocked suppliers), scorecards |
| LOG | Logistics | 023 | Built | Carriers, shipments, freight posting |
| BI | BI Dashboards | 024 | Built | 8 governed datasets, dashboards, widgets |
| DOC | Documents | 025 | Built | Versions with SHA-256 tamper check, legal hold, retention purge |
| FLT | Fleet | 026 | Built | Vehicles, conflict-free assignments, odometer-checked fuel posting |
| COM | Subscriptions & AMC | 027 | Built | Plans; idempotent catch-up billing run (unique subscription + period); prorated final period; per-subscription isolation; optional AMC contract in SRV; MRR/ARR |
| EPM | Budgets & Planning | 028 | Built | Versioned P&L budgets by account and month; SoD approval; BUDGET_LOCKED; revise → v+1; budget vs actual from posted journals |
| LND | Customer Financing | 029 | Built | Annuity and equal-principal schedules (last instalment absorbs rounding); maker-checker; one-time disbursement; interest-first repayments; payoff closes |
| GRC | Risk & Compliance | 030 | Built | Risk register (inherent/residual, appetite-gated acceptance); evidence-based control tests (FAIL → deficient + incident); incidents with SoD close; heatmap |
| TAL | Recruitment | 031 | Built | Approved requisitions with salary band; candidates; pipeline; scored interviews gate offers; hire → employee record; capacity guard |
| INV | Moving-average costing | 032 | Built | `inventory.costing_method = MOVING_AVERAGE` re-costs on purchase receipt with an `item_cost_changes` audit trail; issues and COGS use the average |

### Honest partials
- **FIFO costing** is not implemented. Only STANDARD and MOVING_AVERAGE exist, and moving average re-costs only on PO receipts. Transfers, counts and returns use the current average.
- **TIM:** technicians can create timesheets for any employee, because employees have no link to a user.
- **SUP:** scorecard quality, price and service scores are entered manually; only delivery is derived from receipts.
- **BI:** the 8 datasets are fixed in code, and widgets are edited as JSON. There is no drag-and-drop builder.
- **DOC:** the entity link is a raw id in the UI. Binary download has no API test (makeRequest parses only JSON), but the tamper 500 and purged 410 cases are tested.
- **FLT:** maintenance is a vehicle status only and is not linked to PM work orders.
- **SRV:** the SLA clock uses a fixed +05:00 offset, which is correct for PKT because it has no DST.
- **EPM:** the fiscal year is the calendar year. Budgets cover P&L accounts only; there is no cost-centre dimension and no PO budget-availability check.
- **LND:** interest is recognised on a cash basis when it is collected. There is no accrual, penalty interest or restructuring.
- **COM:** billing is in advance on the anniversary. There is no mid-period upgrade proration and no automatic scheduled run; it is triggered manually or via the API.
- **TAL:** there is no candidate self-service portal and no CV file upload (DOC could hold the files).

## Verified Capabilities (actual command output, 2026-10-01 05:2x PKT)
- `npx vitest run`: **26 files, 240 tests, all passing**.

  | New test file (round 2) | Tests |
  | --- | --- |
  | `partials.test.ts` (ADM/CFG/TAX/WMS/AUT) | 12 |
  | `service.test.ts` | 10 |
  | `crm.test.ts` | 5 |
  | `time.test.ts` | 4 |
  | `supplier.test.ts` | 4 |
  | `logistics.test.ts` | 2 |
  | `bi.test.ts` | 5 |
  | `documents.test.ts` | 3 |
  | `fleet.test.ts` | 3 |
  | `subscriptions.test.ts` | 6 |
  | `budgets.test.ts` | 4 |
  | `lending.test.ts` | 5 |
  | `grc.test.ts` | 5 |
  | `talent.test.ts` | 4 |
  | `costing.test.ts` | 3 |

- `npx tsc --noEmit -p .` and `npm run lint`: 0 errors.
- `npm run build`: exit 0, with **no chunk-size warning**. Views are `React.lazy`-split; the largest chunk is `index` at 207 kB (65 kB gzip), down from 680 kB.
- Screenshots: `/workspace/erp-screens/after` has 74 PNGs, including 38 `mod-*` module shots.

### Intentional test changes
- `packages/platform/test/platform.test.ts`: the user count went from 7 to 10 (new personas: service, tech, hr).
- `apps/api/test/automation.test.ts`: the rule count went from 11 to 12 (new `SRV-SLA-PM` job).

## Blockers
- None for the build.
- `npm audit` still reports 5 advisories, all in dev tooling: vite, esbuild, vite-node, vitest and @vitest/mocker. Every fix requires a major upgrade, so it was deferred. None of these packages ship in production bundles.

## Last Actual Checks
- `npx vitest run`: 26 files, 240 passed.
- `npm run build`: exit 0, no warnings.
- `npm run lint`: exit 0.

## Module coverage
- All 13 previously missing catalog modules are now implemented (see the table above): CRM, DOC, FLT, GRC, LND, LOG, EPM, TAL, BI, SRV, COM, SUP and TIM.
- ADM, CFG, TAX, WMS and AUT are complete for the scope in the table.

## Next Roadmap Milestones
- **Milestone 10**: Logistics, Freight Management & Landed Cost Tracking.
- **Milestone 11**: Multi-Company Consolidation, Inter-Company Transactions & Elimination Journals.
