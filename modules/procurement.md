# Procurement, sourcing and purchasing

**Module ID:** procurement  
**Prefix:** PUR  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md), [ap-expenses](ap-expenses.md)

## Workflow and entities
Request -> approve -> source/award -> order -> receive -> match/pay.
Owned entities: Requisition, RFQ, bid, award, PO/version, receipt link, service acceptance, contract call-off. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Bind approval to revisions; inventory owns stock facts; accepted service is not fake receipt.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| PUR-001 | Requisitions | Record goods/services/project requests | Invalid budget scope cannot submit |
| PUR-002 | Approvals | Route by value/entity/category/risk | Restricted self-approval fails |
| PUR-003 | Catalog buying | Use approved supplier catalog | Changed price needs exception |
| PUR-004 | RFQs | Invite eligible suppliers with deadlines | Bid revisions retained |
| PUR-005 | Bid comparison | Normalize currency/UOM/landed cost | Conversion assumptions visible |
| PUR-006 | Awards | Approve multi-supplier allocations | Award bounded by request |
| PUR-007 | PO issue | Snapshot approved lines/terms/schedules | Issued document retrievable |
| PUR-008 | Blanket contracts | Track quantity/value/expiry | Concurrent call-offs bounded |
| PUR-009 | Amendments | Reapprove material changes | Original receipt provenance retained |
| PUR-010 | Partial receipt | Track accepted/rejected/returned/balance | Overreceipt beyond tolerance rejected |
| PUR-011 | Service acceptance | Certify milestone/hour/period | References approved commercial line |
| PUR-012 | Supplier return | Link disposition/credit expectation | Cannot exceed eligible receipt |
| PUR-013 | Budget reservations | Reserve/release remaining commitment | Cancellation releases eligible amount only |
| PUR-014 | Expediting | Assign late line follow-up | Closed line not reactivated |
| PUR-015 | Landed costs | Capture allocated freight/duty | Allocated sum preserves approved total |
| PUR-016 | Subcontracting | Track company materials and outside work | Ownership not double-counted |
| PUR-017 | Purchase analytics | Define spend/commitment/price variance | Actual agrees with AP population |
| PUR-018 | Reorder proposals | Accept stock/MRP suggestions | Proposal cannot directly pay |
| PUR-019 | Emergency purchase | Review justified exception | Authority/budget still audited |
| PUR-020 | Document chain | Navigate request to settlement | Partial allocations visible |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: PO amendment after receipt; budget race; excess receipt; duplicate award.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

