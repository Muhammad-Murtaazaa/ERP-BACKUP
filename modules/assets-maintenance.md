# Fixed assets, equipment and maintenance

**Module ID:** assets-maintenance  
**Prefix:** AST  
**Readiness:** planned; verify each enabled feature  
**Hard dependencies:** [platform](platform.md), [finance-gl](finance-gl.md)

## Workflow and owned entities
Acquire -> capitalize/assign -> maintain/depreciate -> transfer -> dispose.
Entities: Asset, depreciation book, capitalization, equipment, meter, plan/order, disposal. Operators, reviewers, managers, administrators, employees/portal identities where relevant and auditors have separate scoped permissions; sensitive fields receive explicit grants.

## Invariants
Accounting asset and equipment distinct; capital/expense policy reviewed.
Every feature inherits [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md), relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md) and [LOCALIZATION.md](../LOCALIZATION.md). Optional stock/provider integrations require declared capabilities; no implied certification.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| AST-001 | Asset registry | Track source/category/custodian/location | Wrong-entity source rejected |
| AST-002 | Capitalization | Approve eligible components/in-service date | Cost not capitalized twice |
| AST-003 | CIP | Accumulate construction costs | Transfer basis reconciles |
| AST-004 | Depreciation books | Version method/life/residual | Cannot fall below allowed residual |
| AST-005 | Depreciation run | Post approved schedule | Occurrence retry once |
| AST-006 | Transfers | Move custody/entity under policy | Accounting consequence reviewed |
| AST-007 | Revaluation/impairment | Gate reviewed treatment | Historical evidence retained |
| AST-008 | Disposal | Record sale/scrap/gain/loss | Cannot dispose twice |
| AST-009 | Verification | Assign physical counts/evidence | Count not silently change value |
| AST-010 | Lease asset gate | Support reviewed ROU/liability schedules | Rental flag not prove compliance |
| AST-011 | Equipment | Model serviceable hierarchy/warranty | Asset link optional/explicit |
| AST-012 | Maintenance plans | Generate calendar/meter jobs | Same due occurrence once |
| AST-013 | Corrective work | Record failures/downtime | Safety hold prevents return |
| AST-014 | Maintenance scheduling | Allocate labor/parts/outage | Capacity conflicts surfaced |
| AST-015 | Permits | Apply required safety checklists | Missing permit blocks restricted work |
| AST-016 | Meters | Validate monotonic/rollover readings | Impossible reading needs review |
| AST-017 | Spares | Issue/return stock | Replay not duplicate |
| AST-018 | Maintenance costing | Link actual labor/parts/vendor cost | Capital/expense reviewed |
| AST-019 | Reliability | Define MTBF/MTTR/downtime | Missing telemetry labeled |
| AST-020 | Asset reconciliation | Tie register/depreciation/disposal to GL | Variance identifies book/source |

## UI, reporting and automation
Role workspace; scoped list/detail/editor; approval/execution review; source links; historical timeline; attachments; contextual help and authorized import/export. Use [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md). [REPORTING.md](../REPORTING.md) defines dates/currency/grain/freshness/drill-through. Emit committed events via outbox; reminders/routing/proposals and controlled actions follow [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Sensitive documents/data are excluded from broad search, logs and AI by default.

## Regression and lifecycle
Domain cases: Backdated asset; repeated disposal; meter rollover; duplicate maintenance.
Also test unauthorized field/scope access, stale edit, replay, invalid state/effective date, unavailable dependency, worker crash, retention/legal holds. Physical schemas/command payloads are elaborated for selected slices under [DATA-MODEL.md](../DATA-MODEL.md). Enable validates dependencies/configuration/local scope. Disable drains open obligations and retains authorized historical/settlement/correction access; never deletes source facts.

