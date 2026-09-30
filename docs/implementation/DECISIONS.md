# Implementation Decisions and Architecture Decision Records (ADRs)

## ADR-001: Platform Architecture, Monorepo Structure & Exact Decimal Arithmetic
- **Context**: Omnysync ERP requires exact decimal arithmetic (no JavaScript IEEE 754 floating-point numbers for money, quantities, or taxes), robust multi-tenant organization scoping, strict TypeScript contracts, immutable accounting records, and support for both client-hosted VPS and embedded development/demo environments.
- **Decision**:
  1. Use `decimal.js` for all in-memory calculations, enforcing fixed precision (e.g., 24,8 for quantities/amounts, 24,12 for FX rates), explicit half-up rounding, and string-serialized boundaries across API and database layers.
  2. Implement an npm workspace monorepo dividing domain layers into `@omnysync/contracts`, `@omnysync/financial-engine`, `@omnysync/platform`, `@omnysync/ui`, `@omnysync/api`, and `@omnysync/web`.
  3. Support PostgreSQL through standard SQL migrations and dual runtime engines: standard PostgreSQL via `pg` pool for production/client instances, and `@electric-sql/pglite` (WebAssembly PostgreSQL 16 engine) for local self-contained zero-dependency execution and rapid reproducible testing.
  4. Ensure Row-Level Security (RLS) policies and transaction-scoped context variables (`app.current_organization_id`, `app.current_user_id`) operate consistently across both environments.
- **Consequences**:
  - High confidence in zero float rounding drift.
  - Test suites can run in milliseconds with full PostgreSQL dialect support without requiring external Docker setup, while remaining 100% compatible with production PostgreSQL 16+.
- **Revisit Trigger**: High-throughput distributed scaling requirements requiring distinct microservices or analytical stores.

## ADR-002: Four-Level COA and Leaf-Only Posting Invariant
- **Context**: Requirement PRD-004, GL-001, and COA.md mandate a strictly enforced 4-level hierarchy: L1 (Statement Class), L2 (Group), L3 (Subgroup), L4 (Account). Only L4 leaf accounts can receive journal postings.
- **Decision**:
  - Enforce level constraints in SQL and in domain validation.
  - Provide database-level triggers and domain checks that reject any posting referencing accounts where `level != 4` or `posting_allowed != true`.
  - Parent accounts roll up purely by aggregation over leaf account postings.
- **Consequences**:
  - Eliminates structural accounting errors and accidental postings to classification headings.
- **Revisit Trigger**: Client localization packs that require arbitrary n-level account hierarchies.

## ADR-003: Treasury Two-Way Bank Matching & FX Revaluation
- **Context**: Accurate cash positions require reconciling bank statement lines with ERP payments and handling daily exchange rate volatility without introducing unapproved balance modifications.
- **Decision**:
  1. Electronic bank statement ingestion creates distinct statement lines matched to system payment records.
  2. Direct bank fees automatically generate and post balanced journal vouchers during reconciliation.
  3. Revaluation computes unrealized FX gains/losses across open foreign-currency monetary balances at period-end, posting to designated P&L accounts.
- **Consequences**:
  - Full auditability of cash position reconciliation with zero manual ledger overrides.

## ADR-004: Workforce Salary Structures & Gross-to-Net Engine
- **Context**: Statutory compliance and corporate payroll require transparent gross-to-net salary computation, progressive income tax withholding, pension contributions (EOBI), and multi-tier GL expense allocation.
- **Decision**:
  1. Salary structures are decoupled into modular allowances (Basic, HRA, Utility, Medical) and assigned to employees with effective dates.
  2. Progressive tax slabs calculate withholding tax dynamically with exact decimal precision.
  3. Batch payroll execution generates balanced dual-stage vouchers: first accrual (`Dr Salaries Expense / Cr Tax Withholding / Cr EOBI / Cr Net Salaries Payable`), followed by bank disbursement (`Dr Net Salaries Payable / Cr Operating Bank`).
- **Consequences**:
  - Zero rounding discrepancies in employee payslips and GL balance sheets.

## ADR-005: Multi-Warehouse Logistics, Inventory Reconciliations & Work Order Assembly Costing
- **Context**: Manufacturing operations and multi-location logistics require strict stock movement traceability, explicit scrap allocation, two-leg transfer tracking, and variance-driven cycle count adjustments without bypassing GL controls.
- **Decision**:
  1. Inter-warehouse transfers track two explicit legs (`shipped_qty` / `IN_TRANSIT` -> `received_qty` / `COMPLETED`) to prevent stock double-counting or disappearing goods.
  2. Physical inventory count reconciliations compute exact decimal variances, posting balanced adjustments (`Dr Inventory Adjustments 511002 / Cr Inventory 113001` or surplus).
  3. Bills of Materials (BOM) explosion factors in batch yield and scrap percentages.
  4. Work order completion settles WIP to finished goods and scrap (`Dr Finished Goods 113004 / Dr Scrap 511003 / Cr WIP 113003`).
- **Consequences**:
  - Full traceability across warehouse bins, lot batches, and manufacturing WIP accounts with verified double-entry balance sheet reconciliation.

## ADR-006: Project Costing, Bill of Quantities (BOQ) & Interim Payment Certificate (IPC) Invoicing
- **Context**: Construction, EPC, and contracting workflows require detailed contract quantification (BOQ), Work Breakdown Structure (WBS) cost centers, cumulative measurement validation (to prevent over-billing), and retention money withholding on interim progress certificates.
- **Decision**:
  1. Projects link to operational/project cost centers and record contract value, budgeted cost, and contract retention percentage.
  2. Bill of Quantities (BOQ) maintains contract quantities and unit rates, enforcing an over-certification guard (`certified_quantity + current_quantity <= contract_quantity`).
  3. Progress certificates compute cumulative quantities, gross certified amount, retention money deduction (`gross * retention_pct / 100`), and net billable amount.
  4. Generating a progress invoice posts a balanced General Ledger voucher:
     $$\text{Dr Trade AR Control (112001)} \ [Net] \ + \ \text{Dr Project Retention Receivable (112003)} \ [Retention] = \text{Cr Project Milestone Revenue (411003)} \ [Gross]$$
- **Consequences**:
  - Eliminates contract over-billing, automates retention money accounting on balance sheets, and provides real-time project profitability tracking.

