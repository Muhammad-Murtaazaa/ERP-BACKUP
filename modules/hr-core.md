# Core HR and employee lifecycle

**Module ID:** hr-core  
**Prefix:** HR  
**Readiness:** planned; verify each enabled feature  
**Hard dependencies:** [platform](platform.md)

## Workflow and owned entities
Hire -> onboard -> manage changes/self-service -> support -> exit/settle -> retain.
Entities: Employee, employment/version, position, compensation, onboarding, offboarding, case, documents. Operators, reviewers, managers, administrators, employees/portal identities where relevant and auditors have separate scoped permissions; sensitive fields receive explicit grants.

## Invariants
Effective-dated employment separate from login; sensitive data protected in UI/search/export/analytics/AI.
Every feature inherits [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md), relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md) and [LOCALIZATION.md](../LOCALIZATION.md). Optional stock/provider integrations require declared capabilities; no implied certification.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| HR-001 | Employee profile | Store directory/contact/emergency/work data | Restricted fields hidden |
| HR-002 | Employment history | Version status/company/job/location/manager | Invalid overlapping dates rejected |
| HR-003 | Positions | Approve funded slots/grades/reporting | Restricted slot cannot auto-hire |
| HR-004 | Org chart | Show effective scoped structure | Protected population hidden |
| HR-005 | Job catalog | Version description/skills | Historical description retrievable |
| HR-006 | Contracts | Track signed terms/renewals | Signed version immutable |
| HR-007 | Probation | Schedule reviewed decisions | Reminder not confirmation |
| HR-008 | Onboarding | Assign HR/IT/manager tasks | Required evidence gates completion |
| HR-009 | Provisioning | Request approved login/role | Employee creation not privileged access |
| HR-010 | Asset custody | Link equipment/badge/return | Exit shows unreturned items |
| HR-011 | Employee self-service | Request permitted profile changes | Cannot directly edit approved pay |
| HR-012 | Manager self-service | Approve scoped team requests | Team access follows grants |
| HR-013 | Compensation history | Version approved salary/allowances | Hidden pay not exposed via export |
| HR-014 | Transfers/promotions | Approve dated changes | Historical payroll unchanged |
| HR-015 | Multiple assignments | Model secondment/part-time scope | Eligibility/time/pay explicit |
| HR-016 | Documents | Track IDs/visas/certification expiry | Mandatory expiry assigned review |
| HR-017 | Letters | Issue reviewed language/template | Issued version retrievable |
| HR-018 | Employee relations | Protect grievance/discipline cases | Ordinary search cannot find case |
| HR-019 | Safety incidents | Record necessary evidence | Medical data not in directory |
| HR-020 | Accommodations | Share minimal approved adjustments | Only necessary action exposed |
| HR-021 | Acknowledgments | Track policy version acceptance | Accepted version attributable |
| HR-022 | Employee loans | Link approved receivable/recovery | Recovery bounded by outstanding |
| HR-023 | Exit | Approve resignation/termination process | History not deleted |
| HR-024 | Final settlement | Apply reviewed pay/leave/loan terms | Balances reconcile |
| HR-025 | Revocation | Expire sessions/keys on policy date | Former identity loses access |
| HR-026 | Rehire | Preserve prior employment/settlement | Original service history retained |
| HR-027 | HR metrics | Define dated headcount/turnover | Sensitive small groups suppressed |
| HR-028 | Retention | Review local record classes/holds | Legal hold prevents purge |
| HR-029 | Mobility | Track relocation/assignment | Country change triggers rule review |
| HR-030 | Employee feedback | Publish surveys with privacy policy | Anonymity claims match actual controls |

## UI, reporting and automation
Role workspace; scoped list/detail/editor; approval/execution review; source links; historical timeline; attachments; contextual help and authorized import/export. Use [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md). [REPORTING.md](../REPORTING.md) defines dates/currency/grain/freshness/drill-through. Emit committed events via outbox; reminders/routing/proposals and controlled actions follow [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Sensitive documents/data are excluded from broad search, logs and AI by default.

## Regression and lifecycle
Domain cases: Rehire; retroactive manager; salary inference; exit session.
Also test unauthorized field/scope access, stale edit, replay, invalid state/effective date, unavailable dependency, worker crash, retention/legal holds. Physical schemas/command payloads are elaborated for selected slices under [DATA-MODEL.md](../DATA-MODEL.md). Enable validates dependencies/configuration/local scope. Disable drains open obligations and retains authorized historical/settlement/correction access; never deletes source facts.

