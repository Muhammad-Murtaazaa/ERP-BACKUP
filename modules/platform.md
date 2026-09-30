# Platform, organization and identity

**Module ID:** platform  
**Prefix:** PLT  
**Readiness:** planned; feature-level verification required  
**Personas:** Client administrator, security administrator, auditor  
**Hard dependencies:** Always-on core

## Purpose and workflow
Create organization -> configure entities -> invite -> scope roles -> activate -> review/revoke.

## Owned entities
Organization, legal entity, branch, identity, membership, role, grant, session, delegation. Fields/physical schemas are elaborated for the selected release slice under [DATA-MODEL.md](../DATA-MODEL.md).

## Controls and boundaries
Identity, person and employee are separate; every access path enforces organization and entity scope.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and applicable financial/design/localization rules. Operational-only and financial modes must be explicit; optional integrations require their own readiness.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| PLT-001 | Organizations | Configure business units, legal entities and branches | Inactive branch cannot receive new operations |
| PLT-002 | Entity settings | Set legal identity, currency, fiscal calendar and registrations | Used functional-currency change needs reviewed migration |
| PLT-003 | Shared parties | Link customer/vendor/contact roles | Vendor role alone grants no customer access |
| PLT-004 | Invitations | Verify, activate, suspend and revoke identities | Suspension invalidates prohibited active sessions |
| PLT-005 | SSO | Integrate tenant-bound OIDC/SAML claims | Wrong issuer or membership rejected |
| PLT-006 | MFA/recovery | Enforce strong factors and audited recovery | Recovery cannot bypass administrator policy |
| PLT-007 | Scoped roles | Compose resource actions and entity/branch/warehouse scope | Unscoped grants cannot access another entity |
| PLT-008 | Field security | Restrict payroll/bank/tax/confidential data | Search/export/aggregate preserve restrictions |
| PLT-009 | Segregation | Block prohibited creator/approver/payment combinations | Forbidden self-approval fails server-side |
| PLT-010 | Delegation | Record actor, scope, expiry and acting identity | Expired delegation rejected by jobs and APIs |
| PLT-011 | Service identities | Use narrowly scoped revocable integration credentials | Credential cannot exceed its capability scope |
| PLT-012 | Sessions | Inspect/revoke devices and session tokens | Revoked session cannot execute new command |
| PLT-013 | Calendars | Configure timezone, workdays, holidays and fiscal dates | Midnight event selects correct business date |
| PLT-014 | Numbering | Allocate entity/document/calendar sequences transactionally | Concurrent creation has unique numbers |
| PLT-015 | Reference data | Version currencies, countries, UOM and categories | Historical transactions retain original meaning |
| PLT-016 | Notifications | Deliver preference-aware authorized tasks/messages | Protected records absent from unauthorized messages |
| PLT-017 | Search | Index safe scoped records and snippets | Revoked access removed from results |
| PLT-018 | Task inbox | Aggregate assigned exceptions and approvals | Task references current source state/revision |
| PLT-019 | Audit explorer | Filter actor, source, action and reason | Auditor cannot modify evidence |
| PLT-020 | Files | Scope objects, scan/quarantine and downloads | Forged object key cannot cross scope |
| PLT-021 | Localization | Translate labels and format dates/numbers | Canonical stored values unchanged |
| PLT-022 | Quotas | Bound exports/imports/jobs/storage use | Resource exhaustion leaves committed transactions intact |

## Screens, roles and reports
Provide task workspace; scoped searchable list; detail/editor; approval or execution panel; source links; timeline; import/export; settings and contextual help. Implement relevant [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) patterns. Dashboard definitions, date/currency context and source drill-through follow [REPORTING.md](../REPORTING.md). Permissions separate view/edit/approve/execute/post/reverse/export/admin, including sensitive fields and entity scope.

## Automation and integration
Events are emitted only after committed commands through the outbox. Automate reminders, routing, validated proposals and exception queues; financially material execution inherits [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Each connector gets scoped credentials, idempotency, unknown-outcome reconciliation, effective policy versions and capability-specific tests. Imports go through the same command invariants; never direct-write balances.

## Failure, retention and lifecycle
Domain regression cases: Cross-organization enumeration; session revocation; forbidden delegation; entity switch with unsaved draft.
Also test forbidden scope, stale revisions, duplicate command/event, unavailable dependency and worker restart. Financial corrections preserve facts; protected records obey [SECURITY.md](../SECURITY.md) and local retention. Enable validates dependencies/configuration/country readiness. Disable drains new work, handles open obligations and retains authorized historical/correction access; it never deletes facts. Register a versioned manifest per [MODULE-CONTRACT.md](../MODULE-CONTRACT.md).

