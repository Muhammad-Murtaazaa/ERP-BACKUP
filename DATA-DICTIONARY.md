# Core data dictionary
Logical field specification for implementation. Apply scope, audit, exact types, retention and composite FK rules from DATA-MODEL.md to all module entities. This is not a complete production DDL for every catalog feature.

## Shared aggregate fields
| Field | Logical type | Required behavior |
| --- | --- | --- |
| id | UUID/opaque ID | Stable, server-assigned; never business-number authorization |
| organization_id | ID | Required scope, FK and RLS |
| legal_entity_id | ID, where applicable | Required on accounting/owned operational facts |
| branch_id | ID, conditional | Must belong to permitted entity |
| business_number | Text | Unique under approved document/entity/calendar sequence |
| revision | Integer | Increment on permitted edit; expected_revision required |
| business_date | Date | Entity calendar/date-only semantics |
| created_at / updated_at | UTC timestamp | Server-set audit time |
| created_by / updated_by | Actor ID | Real actor retained with delegation metadata |
| state axes | Enumerated values | Commercial/accounting/fulfillment/settlement independent |
| configuration_version | ID | Applied policy/mapping snapshots |
| archive / hold | State/references | No retention bypass |

## Account and mapping
| Entity | Fields beyond shared contract | Key validation |
| --- | --- | --- |
| account | code/name/translations, parent_id, level, statement_class, normal_balance, posting_allowed, control_type, currency restriction, dimensions, effective dates | Four-level shape; parents nonposting; no cycles; used history protected |
| account_mapping | purpose, entity/book, priority, predicates, posting_account_id, required dimensions, approved_version, effective dates | No ambiguity; compatible leaf/control classification |
| book | name, accounting policy, functional/reporting currency, calendar, source requirements | Approved source completeness |
| period | start/end dates, state, allowed adjustment actors, closed/reopened evidence | Nonoverlap; shared lock with posting |

## Journals and source facts
| Entity | Fields beyond shared contract | Key validation |
| --- | --- | --- |
| journal | book_id, document/posting dates, source_type/id/version, purpose, base currency, FX snapshot, mapping version, approval hash, reversal_of_id | Unique source-purpose; open period; immutable posted state |
| journal_line | journal_id, line_no, account_id, base_debit/base_credit, transaction currency/amount, party/open-item reference, dimensions, source_line/tax tags | Exact finite decimal; one nonnegative side; valid leaf; scoped FK |
| open_item | source document/line, party role, original currency/base amount, due schedule, credit/dispute/advance class, posting fact | Outstanding derived from approved facts and bounded allocations |
| allocation | receipt/credit source, target open item, transaction/base amount, FX policy, date, reversal reference | Lock eligible source/target; no overapplication |
| payment_intent | beneficiary version, approved amount/currency, purpose, provider, stable key/reference, status, reserved entitlement, response evidence | Changed beneficiary invalidates approval; unknown outcome retained |

## Commercial documents
Invoice/PO/order header: party/address/tax/terms snapshot, source chain, line totals, discounts/charges/withholding/rounding, currency/FX policy, approval/version, independent states and issued template version.
Line: item/service, description snapshot, quantity/UOM/conversion, unit price/discount/tax basis, currency amount, dimensions, source allocations and remaining-entitlement facts.
Do not store only a grand total; retain enough canonical inputs to reproduce exact arithmetic. Do not use mutable party master addresses to render old issued documents.

## Inventory
| Entity | Fields beyond shared contract | Key validation |
| --- | --- | --- |
| item | type/category/variant, stock UOM, tracking/valuation policy, tax class, active dates | Used policy transitions reviewed |
| conversion | from/to UOM, exact numerator/denominator or decimal factor, effective version | Positive, unambiguous, reproducible |
| stock_movement | item/location/from-to, lot/serial, quantity/UOM, direction/purpose, source key, date, ownership, reversal | Immutable; same scope; no double execution |
| reservation | source line, eligible resource, quantity, expiry/state, release link | Serialized against availability |
| value_layer | movement, original/remaining quantity/value, cost currency/base basis, policy version | No overconsumption; cost adjustments separate |
| serial / lot | item, external code, origin/expiry, quality state, genealogy refs | Unique serial lifecycle; hold respected |
| count | scope/snapshot date, assigned counter, actual/recount, approved variance | Blind count policy; authorized adjustment |

## Manufacturing / project
BOM: item/version/site/effective date, component/UOM/quantity/yield/substitution and approved routing link. Production order freezes these and records planned/actual consumption/output, operations, WIP and quality. Source purpose keys separate issue/completion/variance.
BOQ: project/version, parent section, item/UOM, original/revised quantity/rate, approved variation refs. Certificates record current/cumulative eligible quantities and commercial approval. Retention/advance are separate balance facts.

## HR / payroll
Employee directory, sensitive identity/bank/tax/medical fields and employment/compensation versions have separate access categories. Employment dates and reporting relationships versioned.
Pay run freezes cycle/population/time/elections/rule versions and stores employee component lines, exact gross/deductions/net/employer liabilities, exceptions and review hash. Payment intents/payslips linked by version. Original pay lines remain immutable after posting; retro differences separate.

## Workflow / audit
Outbox: event ID/type/schema, organization/entity, aggregate revision, minimal payload, correlation/causation, occurrence/business date, due/status/lease/attempt.
Inbox: consumer/provider + event ID uniqueness, received/effect status and safe evidence.
Workflow run/step: frozen definition version, source revision, typed inputs/outputs, actor/service scope, lease/attempt, waits/deadlines and compensation links.
Audit: actor/delegated identity, scope/action/source, timestamp/reason/config version, protected before/after evidence and independent checkpoint reference where configured.

## Field elaboration gate
Before coding a slice, expand each entity into column/nullability/type/FK/index/check/permission/retention metadata and migration tests. Validate bounds for real industry quantities and currencies. Schema design review must cover every feature's changed entities; a generic JSON blob is not a substitute for finance/inventory constraints.

