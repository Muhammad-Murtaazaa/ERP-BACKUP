# Governance, risk and audit controls

**Module ID:** governance-risk  
**Prefix:** GRC  
**Readiness:** planned; scope-specific verification required  
**Hard dependencies:** [platform](platform.md)

## Workflow and entities
Define -> review/monitor -> evidence -> investigate -> remediate -> verify.
Owned entities: Control, policy, risk, review, waiver, hold, finding, remediation. Separate operators, process owners, approvers, administrators and auditors; portal users access only their authorized party records.

## Controls
Evidence and enforcement distinct; dashboards do not certify compliance.
All rows inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [SECURITY.md](../SECURITY.md), [logic.md](../logic.md) and relevant financial/localization rules.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| GRC-001 | Controls | Assign owner/evidence/frequency | Missing evidence visible |
| GRC-002 | Risk register | Review impact/likelihood/mitigation | Score source retained |
| GRC-003 | Segregation review | Detect grants/actor conflicts | Exception expires with compensating control |
| GRC-004 | Access certification | Review user/service grants | Revocation enforced |
| GRC-005 | Audit evidence | Protect action/configuration/source trail | Auditor cannot edit |
| GRC-006 | Change review | Approve material mappings/rules/extensions | Draft cannot activate |
| GRC-007 | Policies | Version acknowledgments | Accepted version attributable |
| GRC-008 | Incidents | Restrict case/actions | Unauthorized enumeration rejected |
| GRC-009 | Findings | Assign deadline/verification | Closure needs evidence |
| GRC-010 | Holds | Protect retained records/files | Purge blocked |
| GRC-011 | Classification | Tag data handling/export/AI policy | Restriction enforced |
| GRC-012 | Privacy cases | Review lawful correction/erasure | Retention conflict explained |
| GRC-013 | Monitoring | Flag unusual access minimally | Sensitive payload absent |
| GRC-014 | Financial controls | Show reconciling/period exceptions | Cannot resolve without source evidence |
| GRC-015 | Third-party risk | Review provider scope/contracts | Expired approval blocks new transmit |
| GRC-016 | Continuity | Track restore/drill evidence | Failed drill creates remediation |
| GRC-017 | Fraud signals | Queue human investigation | No unsupported accusation |
| GRC-018 | Readiness | Publish verified control coverage | No generic certification badge |
| GRC-019 | Waivers | Bound scope/date/reason | Expired waiver unusable |
| GRC-020 | Audit export | Provide scoped evidence chain metadata | Forbidden fields omitted |

## UI, reports and automation
Use scoped task workspace/list/detail/editor, accessible approval or execution panel, timeline, settings, authorized imports/exports and contextual help. [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) define shared behavior. [REPORTING.md](../REPORTING.md) governs metric definitions, date/currency basis and drill-through. Events use committed outbox facts; actions run scoped identities and durable intents under [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Optional adapters have explicit qualification and failure handling.

## Tests and lifecycle
Domain cases: Support expiry; SoD conflict; held-file purge; sensitive log leak.
Also verify field/scope denial, duplicate event/command, stale revision, unavailable dependency, worker crash, conflicting effective date and retention. Schema/API detail is expanded during the chosen slice. Enable requires compatible dependencies/configuration/coverage. Disable drains outstanding work while retaining legal history and authorized correction/settlement. Specialized regulated capabilities remain unavailable until their separate gate passes.

