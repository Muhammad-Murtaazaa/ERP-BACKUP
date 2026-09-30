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
