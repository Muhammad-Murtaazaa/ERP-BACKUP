# Implementation roadmap and release gates
No delivery dates are promised without team size, budget, existing code and target scope. Sequence by dependencies and complete processes. Country workstreams for Pakistan and US begin together and advance capability-by-capability.

| Stage | Outcome | Exit gate |
| --- | --- | --- |
| 0 — Product decisions and proof | Ownership agreement, fit-gap, stack/device spikes, both-country applicability, UI prototypes | Approved ADRs, independent accounting fixtures, tested native device approach |
| 1 — Platform and finance foundation | Organization/access, design components, module manifests, exact money, COA, posting, audit, outbox, client deploy | Scope/RLS/concurrency/period/idempotency tests and clean-host restore |
| 2 — Trading process | CRM/basic quote/order, procurement, inventory, AR/AP, bank reconciliation, dashboards, onboarding | Complete source-to-pay and order-to-cash with partials/returns/credits/FX and reconciliations |
| 3 — Demo factory and handover | Templates, seeds, domain/TLS, persona users, enable/drain/reset, signed builds | Isolated demo verified; production reset impossible; central-disconnect handover passes |
| 4 — Workforce and native use | HR, time/leave, qualified payroll/benefits, field/mobile, desktop devices | Both-country scoped rules independently validated; sensitive access and pay/payment recovery pass |
| 5 — Projects and operations | Jobs/BOQ, assets/service, manufacturing/BOM/MRP/quality, WMS/trade | Complete chosen industry processes, WIP/cost/retention and stock traceability |
| 6 — Advanced suite | EPM/consolidation, advanced recognition, commerce, finite scheduling, lending and extended verticals | Separate expert-reviewed accounting/regulatory/capacity gates per advertised capability |
| Continuous — Reliability and localization | Country updates, accessibility, patching, migration, operating drills, measured automation | Regression evidence and supportability preserved |

Stages can overlap where teams/skills allow, but prerequisites remain mandatory. Demo console work can start at stage 1; stage 3 is its release gate, not an artificial restriction on parallel engineering. Design is continuous, not a polish sprint after business logic.

## First release slice
Select one coherent trading client scenario with simple supported tax/inventory/accounting, then qualify the corresponding Pakistan and US scopes. Candidate requirements include PLT core, GL core, TAX readiness, AR/AP basic documents/allocations, SAL prices/orders/fulfillment, PUR requisition/PO/receipt, INV quantity/valuation, TRY bank import/reconcile, BI role reports, AUT approved routing and CFG onboarding. Advanced rows in those modules remain planned/unavailable until individually tested.

## Work package template
Requirement IDs -> domain scope -> data/command/event contract -> permission/state/financial invariants -> UX reference/screens -> fixtures/tests -> migration -> operational/rollback -> country review -> pilot evidence -> release status. Assign product, domain, engineering, UX, QA, localization/security owners by role; fill actual people later.

## Gate ownership
Product lead accepts user behavior; accountant accepts ledger/treatments; process expert accepts operations; HR/localization specialist accepts applicable workforce/payroll; security reviewer accepts access boundaries; QA accepts recovery/accessibility/performance evidence; client owner accepts handover and production fit-gap.

## Anti-patterns
Do not build hundreds of disconnected CRUD pages; show fake-ready modules; automate payment before reconciliation; add microservices before an operating need; fork core for each customer; defer accessibility; estimate every suite feature as one short project. Budget onboarding, migration, local review and runbooks as product work.

## Planning inputs still required
Engineering headcount/skills, existing code to reuse, first client process/industry, deployment volume/concurrency, native OS/devices, US states/Pakistan provinces, IP terms and support tiers. OPEN-DECISIONS.md records defaults and which decisions block live deployment.

