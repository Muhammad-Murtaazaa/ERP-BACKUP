# Service, support and field operations

**Module ID:** service-management  
**Prefix:** SRV  
**Readiness:** planned; verify each enabled feature  
**Hard dependencies:** [platform](platform.md), [sales-orders](sales-orders.md)

## Workflow and owned entities
Intake -> triage -> schedule -> execute -> accept -> bill -> close.
Entities: Case, SLA, entitlement, appointment, work order, technician, parts/time, acceptance, warranty. Operators, reviewers, managers, administrators, employees/portal identities where relevant and auditors have separate scoped permissions; sensitive fields receive explicit grants.

## Invariants
Explicit SLA calendars/pauses; offline field evidence revalidated; transparent location collection.
Every feature inherits [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md), relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md) and [LOCALIZATION.md](../LOCALIZATION.md). Optional stock/provider integrations require declared capabilities; no implied certification.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| SRV-001 | Case intake | Deduplicate channel requests | Retry creates one case |
| SRV-002 | Triage | Assign priority/owner/reason | Override audited |
| SRV-003 | SLAs | Version response/resolution calendars | Holiday/timezone/pauses correct |
| SRV-004 | Entitlements | Validate contract/warranty allowances | Expired allowance not authorize |
| SRV-005 | Dispatch | Assign skills/resources/windows | Hard capacity conflict rejected |
| SRV-006 | Appointments | Record booking/reschedule | Customer accepted scope retained |
| SRV-007 | Work orders | Guide tasks/safety/checklists | Mandatory check gates close |
| SRV-008 | Parts | Issue/return through stock contract | Replay not double-consume |
| SRV-009 | Time | Approve cost/billable basis | Invalid overlap flagged |
| SRV-010 | Extra work | Quote and accept additional scope | Technician cannot add unauthorized charge |
| SRV-011 | Acceptance | Capture scoped signature/photo/evidence | Binds exact work version |
| SRV-012 | Warranty | Separate covered and chargeable work | Billing follows eligibility |
| SRV-013 | Preventive service | Create recurring jobs | Occurrence deduplicated |
| SRV-014 | Knowledge base | Publish reviewed audience-scoped guidance | Internal article hidden externally |
| SRV-015 | Portal | Expose party-bound cases/status | Other tickets cannot enumerate |
| SRV-016 | Escalation | Route overdue work | Repeated timer not duplicate action |
| SRV-017 | Service billing | Invoice approved labor/parts/fees | Same source not rebilled |
| SRV-018 | Offline drafts | Capture permitted field intents | Disconnected app not post finance |
| SRV-019 | Service metrics | Define SLA/fix/cost bases | Denominators visible |
| SRV-020 | Closure | Check resolution/open obligations | Follow-up retained |

## UI, reporting and automation
Role workspace; scoped list/detail/editor; approval/execution review; source links; historical timeline; attachments; contextual help and authorized import/export. Use [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md). [REPORTING.md](../REPORTING.md) defines dates/currency/grain/freshness/drill-through. Emit committed events via outbox; reminders/routing/proposals and controlled actions follow [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Sensitive documents/data are excluded from broad search, logs and AI by default.

## Regression and lifecycle
Domain cases: SLA boundary; competing dispatch; duplicate parts; ineligible warranty.
Also test unauthorized field/scope access, stale edit, replay, invalid state/effective date, unavailable dependency, worker crash, retention/legal holds. Physical schemas/command payloads are elaborated for selected slices under [DATA-MODEL.md](../DATA-MODEL.md). Enable validates dependencies/configuration/local scope. Disable drains open obligations and retains authorized historical/settlement/correction access; never deletes source facts.

