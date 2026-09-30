# Data model and transaction ownership
Logical model baseline; complete physical column definitions and migrations are elaborated for each selected release slice. No illustrative schema is production certification.

## Shared fields
Business aggregates have id, organization_id, optional legal_entity_id/branch_id, business number, state axes, revision, created_at/by, updated_at/by and archive/retention metadata. Facts add business_date, source identity/version, currency/amount or quantity/UOM, rule versions and immutable evidence. UTC timestamps are TIMESTAMPTZ; document/payroll/fiscal dates are DATE; entity timezone drives date boundaries. IDs are opaque, stable, server-generated.

## Entity map
| Owner | Main entities / relations | Mandatory constraints |
| --- | --- | --- |
| Platform | installation, organization, legal_entity, branch, membership, role, permission, scope_grant | Membership valid in resolved organization; role alone is insufficient |
| Configuration | module_installation, capability_state, configuration_version, extension_manifest, rule_version | Versioned activation; dependency validation |
| Identity | person, login_identity, employee/customer/vendor links | A shared person identity does not grant business access |
| Parties | party, party_role, contact, address, bank_detail_version, tax_registration | Approved banking change; effective identifiers and scoped dedupe |
| Items | item, variant, category, uom, uom_conversion, price_list, tax_class | Exact conversion; serial/lot/valuation policy immutable after use or migrated |
| Finance | book, fiscal_calendar, period, account, account_mapping, journal, journal_line | Leaf-only, same-scope FK, base-balanced posted journals, unique source purpose |
| AR/AP | invoice, invoice_line, credit_note, open_item, allocation, payment_intent | Allocation bounded under concurrency; no duplicate provider execution |
| Banking | bank_account, statement, statement_line, match, reconciliation | Unique import evidence; reconciled line cannot match twice |
| Inventory | warehouse, bin, lot, serial, stock_movement, reservation, value_layer, valuation_adjustment | Scope + location/item consistency; quantity/value immutable facts |
| Procurement | requisition, rfq, bid, purchase_order/version, receipt, match_exception | Line remaining quantities and approval revision checked |
| Sales | opportunity, quote/version, sales_order/version, fulfillment | Order line source chain and cancelled/returned balances |
| Production | bom/version, routing/version, work_center, production_order, consumption, operation_actual | Acyclic BOM; order frozen revisions; bounded completions |
| Projects | project, wbs, boq/version, estimate, budget, change_order, progress_certificate, retention | Approved baseline/amendment; measurable entitlement |
| People | employee, employment_version, job, leave_request, time_entry, pay_run, pay_line | Sensitive scoping; effective dating and deterministic payroll snapshots |
| Assets | asset, depreciation_book/schedule, maintenance_plan/order, meter_reading | Accounting asset separate from serviceable equipment |
| Automation | workflow_definition/version, run, step, inbox, outbox, execution_intent | Unique dedupe key; leases and bounded retry |
| Documents | attachment, template/version, retention_hold, signature_reference | Scoped object paths; safe rendering and retained legal evidence |
| Analytics | metric_definition/version, report_definition, dashboard_layout, refresh_watermark | Authorized field population; reproducible as-of filters |
| Control plane | demo_template, environment, domain_binding, release, deployment_policy | Stored separately from client ERP database; no unrestricted client credentials |

## Relationship principles
One organization -> many legal entities -> many branches. One item may be used across entities under policy; financial mapping remains entity/book-specific. One party has customer and vendor roles; AR and AP are never automatically netted. One source line can connect several receipts/fulfillments/invoices/credits through explicit allocation relations; avoid a single nullable source_id that loses partial links.

Every cross-scope FK contains organization_id and relevant legal_entity_id, or uses a validated shared-master exception. Per-entity unique business numbers use document type/fiscal sequence scope; invalid gaps are documented according to local requirements. Sequence allocation uses transaction-safe control, not MAX(number)+1.

## Financial persistence boundaries
Source tables hold operational records/snapshots; subledger facts hold obligations and allocations; journal facts hold accounting effects. Persist all authoritative consequences of a local command in one transaction. Read projections are rebuildable and never the only record of value.

Required indexes: scoped source uniqueness; journal entity/book/date/account; open-item party/date/status; stock item/location/lot/date; outbox due/status; workflow lease/next_run; record business numbers; report query paths. Review real EXPLAIN plans rather than indexing every column.

## Database enforcement
- NOT NULL for scope and invariant fields; CHECK for positive quantities where appropriate and finite decimal amounts.
- Composite FK for scoped references; unique keys for source posting, provider references, inbound dedupe and document numbers.
- Account parent/type/leaf integrity and journal balance need reviewed routines/triggers where plain CHECK cannot validate multiple rows.
- Apply RLS ENABLE/FORCE on relevant organization-scoped tables; non-owner runtime role; explicit USING and WITH CHECK.
- Allow only reviewed posting routines/roles to mutate posted facts; no broad application UPDATE grants.
- Prevent closed-period posting using a shared period lock with close commands.
- Persist approval/configuration evidence and provider response hashes with protected sensitive fields.
- Financial deletes are prohibited; draft cleanup and privacy removal follow retention and referential policies.

## Schema extension
JSONB may store validated custom fields with schema version and typed report extraction. Essential finance, stock, identities, permission and workflow keys must remain explicit constrained columns. Promoted custom fields use controlled migrations and indexes. Arbitrary tenant-provided SQL is prohibited.

## Retention / erasure
Assign records to financial/legal, HR-sensitive, operational, analytics, ephemeral-demo and integration-evidence classes. Country/client retention rules and legal holds control duration. Privacy deletion/anonymization cannot erase legally retained posted evidence; document the lawful review and minimization process. Purge includes objects, replicas, indexes, local clients and backups according to the agreed policy, with restore reapplication of erasure tombstones.

## Migration integrity
Stage -> validate -> map -> preview -> approve -> commit -> reconcile -> archive evidence. Preserve legacy keys and extraction timestamp. Opening quantity/value and AR/AP detail must match opening GL; active orders need remaining quantities, not recreated historical purchases. Rerun by batch key must not duplicate balances.

