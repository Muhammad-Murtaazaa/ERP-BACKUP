# Projects, jobs, BOQ and construction

**Module ID:** projects-boq  
**Prefix:** PRJ  
**Readiness:** planned; verify each enabled feature  
**Hard dependencies:** [platform](platform.md), [finance-gl](finance-gl.md), [sales-orders](sales-orders.md), [procurement](procurement.md)

## Workflow and owned entities
Estimate -> contract/baseline -> plan/commit -> measure -> certify/bill -> final account.
Entities: Project, WBS, estimate, BOQ/version, budget, contract, variation, progress certificate, retention. Operators, reviewers, managers, administrators, employees/portal identities where relevant and auditors have separate scoped permissions; sensitive fields receive explicit grants.

## Invariants
BOQ commercial quantities differ from BOM component consumption; baseline/revised/current/cumulative values separate.
Every feature inherits [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md), relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md) and [LOCALIZATION.md](../LOCALIZATION.md). Optional stock/provider integrations require declared capabilities; no implied certification.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| PRJ-001 | Projects | Define entity/customer/manager/type/dates | Cross-entity source rejected |
| PRJ-002 | WBS | Build scope/tasks/cost-code hierarchy | Dependency cycles rejected |
| PRJ-003 | Estimates | Version material/labor/plant/subcontract basis | Source assumptions retained |
| PRJ-004 | BOQ | Manage section/item/UOM/quantity/rate | Parent totals derived |
| PRJ-005 | Rate analysis | Explain resource rate build-up | Approved assumptions reproduce price |
| PRJ-006 | Baseline budget | Approve commercial/cost/time baseline | Draft not replace baseline |
| PRJ-007 | Schedules | Plan dependency/milestone/capacity | Critical conflict visible |
| PRJ-008 | Resource plan | Allocate people/equipment | Hard overallocations rejected |
| PRJ-009 | Commitments | Link procurement/subcontracts to WBS | Open and actual cost not double-counted |
| PRJ-010 | Site time/material | Approve operational capture | Same source cost not repeated |
| PRJ-011 | Subcontract measurement | Certify supplier entitlement | Cumulative quantity bounded |
| PRJ-012 | Physical progress | Record measured evidence | Progress not automatically earned revenue |
| PRJ-013 | Progress certificates | Certify current/cumulative work | Same entitlement not double-certified |
| PRJ-014 | Variations | Approve scope/rate/budget amendment | Unapproved variation not billable |
| PRJ-015 | Advance recovery | Track approved advances/recoveries | Cannot exceed recoverable balance |
| PRJ-016 | Retention | Hold/release by milestone | Release requires eligible amount |
| PRJ-017 | Billing | Generate milestone/time/progress invoice | Previously billed work unavailable |
| PRJ-018 | Revenue treatment | Apply reviewed book policy | Recognized basis reconciles |
| PRJ-019 | Completion forecast | Estimate remaining cost/revenue | Original baseline visible |
| PRJ-020 | Site documents | Track RFI/submittal/drawing/daily report | Used revision identifiable |
| PRJ-021 | Risk/issues | Assign impact/owner/action | Closure retains evidence |
| PRJ-022 | Claims | Track uncertain entitlement/evidence | Unapproved recovery not actual revenue |
| PRJ-023 | Project dashboards | Define budget/cost/cash/progress metrics | Drill to ledger and commitments |
| PRJ-024 | Final account | Reconcile cost/advance/invoices/retention | Configured unresolved balances block close |
| PRJ-025 | Defects/warranty | Track post-completion obligation | Project close not erase warranty |

## UI, reporting and automation
Role workspace; scoped list/detail/editor; approval/execution review; source links; historical timeline; attachments; contextual help and authorized import/export. Use [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md). [REPORTING.md](../REPORTING.md) defines dates/currency/grain/freshness/drill-through. Emit committed events via outbox; reminders/routing/proposals and controlled actions follow [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Sensitive documents/data are excluded from broad search, logs and AI by default.

## Regression and lifecycle
Domain cases: Overcertification; unapproved variation; duplicate retention release; actual/commitment double-count.
Also test unauthorized field/scope access, stale edit, replay, invalid state/effective date, unavailable dependency, worker crash, retention/legal holds. Physical schemas/command payloads are elaborated for selected slices under [DATA-MODEL.md](../DATA-MODEL.md). Enable validates dependencies/configuration/local scope. Disable drains open obligations and retains authorized historical/settlement/correction access; never deletes source facts.

