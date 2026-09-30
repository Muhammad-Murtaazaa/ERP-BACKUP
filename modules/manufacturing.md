# Manufacturing, BOM, MRP and production

**Module ID:** manufacturing  
**Prefix:** MFG  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md), [inventory](inventory.md), [procurement](procurement.md), [finance-gl](finance-gl.md)

## Workflow and entities
Engineer -> plan -> release -> consume/operate -> inspect -> complete -> settle/close.
Owned entities: BOM/routing version, work center, plan, production order, operation, consumption, completion, WIP. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Freeze BOM/routing on release; mode/cost/optimization capabilities independently validated.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| MFG-001 | Multi-level BOM | Define quantities/UOM/subassemblies | Cycle/conversion errors rejected |
| MFG-002 | Alternatives | Approve substitutes/site variants | Order freezes selected variant |
| MFG-003 | Engineering change | Review effectivity/open-order impact | Released change requires amendment |
| MFG-004 | Routings | Sequence setup/run/yield/dependencies | Dependency cycles rejected |
| MFG-005 | Work centers | Model resource capacity/calendars | Unavailable capacity shown |
| MFG-006 | Production modes | Discrete baseline; gate process/repetitive | Unsupported mode not production-ready |
| MFG-007 | Demand | Combine forecasts/orders without double count | Pegging explains net demand |
| MFG-008 | Master plan | Version horizon/time buckets | Approved plan reproducible |
| MFG-009 | MRP | Net stock/reservations/supply/lead time | Each proposal has source pegging |
| MFG-010 | Purchase proposals | Create reviewed shortage requests | Budget approval not bypassed |
| MFG-011 | Production proposals | Firm eligible planned orders | Acceptance retry not duplicate |
| MFG-012 | Capacity load | Compare demand/resource availability | Overload surfaced |
| MFG-013 | Finite schedule | Gate advanced optimizer constraints | Verified calendars/resources honored |
| MFG-014 | Work orders | Release approved quantity/version | Unapproved definition cannot release |
| MFG-015 | Material issue | Consume actual lot/serial | Retry not double-consume |
| MFG-016 | Backflush | Apply approved consumption basis | Variance visible/reconcilable |
| MFG-017 | Substitution | Authorize replacement/reason/cost | Restricted substitute needs approval |
| MFG-018 | Shop floor | Record start/pause/labor/completion | Duplicate event not duplicate cost |
| MFG-019 | Partial output | Receive eligible completion | Cumulative quantity bounded |
| MFG-020 | Scrap/rework | Record cost/reason/disposition | Scrap not saleable output |
| MFG-021 | Co/by-products | Allocate reviewed joint cost | Eligible cost sum preserved |
| MFG-022 | Subcontract work | Track supplied material/outside processing | Ownership/cost not double-counted |
| MFG-023 | Quality gates | Hold required checks | Blocked output cannot ship |
| MFG-024 | WIP | Accumulate materials/labor/overhead | Remaining balance explainable |
| MFG-025 | Cost variance | Settle standard/actual purpose | Original stock facts unchanged |
| MFG-026 | OEE/yield | Define telemetry measurement basis | Missing observations labeled |
| MFG-027 | Order close | Resolve quantities/cost/quality | Unexplained WIP blocks configured close |
| MFG-028 | Genealogy | Trace component to customer | Split/merge descendants retained |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: BOM cycle; substitution; parallel completion; late cost/WIP.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

