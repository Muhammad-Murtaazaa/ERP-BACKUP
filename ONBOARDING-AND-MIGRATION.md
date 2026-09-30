# Guided onboarding, migration and adoption
Guide a client from their business shape to a reconciled operational system. Demo readiness and production activation use different checklists.

## Onboarding steps
1. Fit-gap: industry, countries/states/provinces, legal entities, branches, sites, user roles, process volumes and regulatory scope.
2. Deployment/ownership: client domain/infrastructure/operator/backup/identity/secrets and handover agreement.
3. Organization: legal names, registrations, business timezone, currencies, fiscal calendars and document numbering.
4. Module selection: explain dependencies, verified readiness and optional industry/country capabilities.
5. People/access: role templates, scope, segregation, MFA/SSO, service keys.
6. Finance: approved four-level COA, book/report taxonomy, source mappings, tax/FX/valuation/revenue policies and bank accounts.
7. Master data: customers/vendors/items/UOM/prices/sites/warehouses/employees/assets/project templates.
8. Workflow/settings: approvals, limits, reminders, optional automation and integrations; preview representative scenarios.
9. Migration: staged validated openings/open documents with reconciliations.
10. Pilot: role task tests, close/payment/stock procedures, backup restore and support training.
11. Go-live: freeze source cutover, reconcile, sign off capabilities, activate qualified connectors, monitor.
12. Adoption: contextual help/checklists and owner-assigned issues; review time savings and learning friction.

## Adaptive guidance
Role-aware home checklist, progress saved, clear blocked prerequisites, example records only in sandbox, skip/resume optional tours and plain-language glossary. Show why a field matters and its consequence. COA mapping wizard simulates invoices, purchases, stock, payroll and financing applicable to selected modules. Disabled features excluded from help/navigation. Never let a skipped onboarding tour waive required finance/localization setup.

## Migration contracts
| Dataset | What must be preserved |
| --- | --- |
| Masters | Legacy IDs, effective attributes, duplicates/merge decisions, country/tax class and UOM |
| GL | Approved opening date/book/entity/dimensions/currency and balanced source evidence |
| AR/AP | Party open items, due dates, credits/advances, allocations and currency; match control GL |
| Stock | On-hand/held/transit/reserved, lot/serial, location, quantity/value; match valued GL |
| Active orders | Original/received/fulfilled/billed/cancelled/remaining entitlement |
| HR/payroll | Employment/pay history, leave/YTD/statutory inputs with sensitive access |
| Assets | Cost/book/depreciation/residual/in-service dates and control GL |
| Projects | BOQ/contract/budget/certified/billed/advance/retention/commitment balances |

## Staging and cutover
Extract with source timestamp/schema -> upload quarantine -> map -> normalize -> validate duplicates/scope/UOM/decimals -> preview errors -> approve -> commit by scoped batch key -> reconcile -> archive evidence. Financial opening batch atomic per defined entity/book unit; cross-batch dependencies must be resolved before go-live. Never independently load GL and subledgers without reconciliation.

Dry run returns counts, row errors, account mapping, totals, trial balance and duplicate risks. Fix/import reruns use the same source keys and cannot duplicate balances. Keep transformed data lineage. Cutover includes source freeze, final deltas, backups, rollback decision point, user communications under client authorization and named reconciliation owners.

## Migration acceptance
Opening trial balance balanced; AR/AP detailed totals match controls; inventory quantity/value agrees; payroll YTD and asset register agree; open orders have correct remaining quantities; sample source links and files accessible; sensitive scope tested; restore from migrated backup passes. Retain signed acceptance evidence.

## Training
Role tasks: create/post invoice; approve PO/receive/match; pick/ship/count; employee leave/time; calculate/review payroll; map accounts/reconcile/close; create/reset demo. Use short task tutorials and annotated help, not a manual-only onboarding. Measure unaided completion/time/error recovery and include users with accessibility needs.

