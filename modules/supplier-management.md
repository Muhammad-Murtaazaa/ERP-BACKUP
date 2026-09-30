# Supplier lifecycle and contract portal

**Module ID:** supplier-management  
**Prefix:** SUP  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md)

## Workflow and entities
Register -> verify -> approve -> transact -> evaluate -> renew/suspend.
Owned entities: Supplier, qualification, bank version, registration, certificate, contract, scorecard, portal membership. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Bank changes reviewed separately; suspension blocks new award without losing liabilities.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| SUP-001 | Supplier directory | Store location/country/contacts/category | Duplicate candidates reviewed |
| SUP-002 | Onboarding | Collect scoped evidence | Applicant sees own record only |
| SUP-003 | Qualification | Approve category/capacity/compliance | Restricted award requires qualification |
| SUP-004 | Tax registration | Version effective IDs/status | Expired status flagged |
| SUP-005 | Bank verification | Approve beneficiary with independent review | Pending release policy revalidated |
| SUP-006 | Risk assessments | Record sources/review dates | Unreviewed score cannot authorize hold release |
| SUP-007 | Certificates | Track expiry/access/quarantine | Missing mandatory evidence blocks award |
| SUP-008 | Contracts | Negotiate/approve/sign/version | Transaction keeps applied version |
| SUP-009 | Prices | Publish approved dated agreements | Expired price unavailable |
| SUP-010 | Scorecards | Define quality/delivery/dispute basis | Metric drills to evidence |
| SUP-011 | Segmentation | Group criticality/category/geography | Grouping grants no extra access |
| SUP-012 | Portal orders | Expose scoped orders/schedules/balances | Supplier cannot enumerate others |
| SUP-013 | Portal invoices | Submit to AP review | Upload cannot post payable |
| SUP-014 | Collaboration | Record clarifications/revisions | Accepted revision explicit |
| SUP-015 | Suspension | Block new commitments | Existing settlement follows reviewed policy |
| SUP-016 | Master merge | Preview and preserve source links | Liability/GL totals unchanged |
| SUP-017 | Renewal reminders | Assign certificates/contracts | Reminder not approval |
| SUP-018 | Concentration | Report exposure by source/currency | Conversion basis stated |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: Payment beneficiary change; portal enumeration; expired certificate; merge with balances.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

