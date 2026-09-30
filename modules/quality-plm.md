# Quality and product lifecycle

**Module ID:** quality-plm  
**Prefix:** QLT  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md), [inventory](inventory.md)

## Workflow and entities
Define -> inspect -> disposition -> correct -> change -> verify.
Owned entities: Specification, inspection, nonconformance, disposition, corrective action, change, genealogy. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Attributable evidence; quality release distinct from receipt; regulated validation separate.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| QLT-001 | Specifications | Version tolerances/units/applicability | Inspection freezes revision |
| QLT-002 | Plans | Define sampling/checks | Required check cannot be omitted |
| QLT-003 | Receiving quality | Record accepted/rejected/held | Only eligible stock available |
| QLT-004 | In-process quality | Gate operation checks | Critical failure blocks completion |
| QLT-005 | Final release | Require quality authority | Forbidden self-release rejected |
| QLT-006 | Nonconformance | Track lots/cause/owner/evidence | Affected stock held |
| QLT-007 | Disposition | Approve scrap/rework/return/use-as-is | Consequence recorded |
| QLT-008 | Corrective actions | Track root cause and effectiveness | Close requires verification |
| QLT-009 | Supplier quality | Link defects to receipt | Sample denominator visible |
| QLT-010 | Calibration | Track equipment checks/certificates | Expired instrument blocks configured use |
| QLT-011 | Engineering requests | Propose item/BOM/routing changes | Released definition immutable |
| QLT-012 | Change approval | Review impact/effectivity | Affected open orders visible |
| QLT-013 | Product documents | Control drawing/spec revisions | Issued document retrievable |
| QLT-014 | Genealogy | Trace split/merge lot/serial relations | All eligible descendants found |
| QLT-015 | Recall | Assign hold/customer/disposition actions | Completion needs evidence |
| QLT-016 | Certificates | Generate verified analysis/conformity | Only approved results included |
| QLT-017 | Quality analytics | Define defect/yield/closure metrics | Exclusions shown |
| QLT-018 | Regulated gate | Require industry validation pack | Base module claims no certification |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: Failed release; superseded spec; missing corrective evidence; recalled lineage.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

