# Payables, expense and payments

**Module ID:** ap-expenses  
**Prefix:** AP  
**Readiness:** planned; feature-level verification required  
**Personas:** AP clerk, employee, approver, treasury operator  
**Hard dependencies:** [platform](platform.md), [finance-gl](finance-gl.md), [tax-compliance](tax-compliance.md)

## Purpose and workflow
Capture -> match -> approve/post -> authorize pay -> settle -> reconcile.

## Owned entities
Supplier invoice, expense claim, match exception, open item, payment proposal/intent. Fields/physical schemas are elaborated for the selected release slice under [DATA-MODEL.md](../DATA-MODEL.md).

## Controls and boundaries
Separate beneficiary changes and release authority; duplicate checks combine source evidence and business keys.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and applicable financial/design/localization rules. Operational-only and financial modes must be explicit; optional integrations require their own readiness.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| AP-001 | Invoice capture | Record supplier goods/services/tax/source | Posted snapshot has balanced obligation |
| AP-002 | Duplicate detection | Check supplier/reference/date/amount/evidence | Potential duplicate requires reviewed resolution |
| AP-003 | Two-way match | Compare PO and invoice under tolerances | Excess amount routed as exception |
| AP-004 | Three-way match | Compare order/accepted receipt/invoice | Unreceived units cannot auto-approve |
| AP-005 | Service acceptance | Confirm supported service milestone | No fictitious stock required |
| AP-006 | Non-PO exception | Route justified unauthorized-source spend | Budget/approval rules still enforced |
| AP-007 | Supplier credits | Apply eligible return/price credits | Concurrent credits cannot overapply |
| AP-008 | Expense claims | Capture receipts/policy/project dimensions | Restricted claim evidence protected |
| AP-009 | Travel advances | Offset approved claims against advances | Expense not recognized twice |
| AP-010 | Corporate cards | Match imported charges to claims | Same charge cannot reimburse twice |
| AP-011 | Recurring bills | Generate approved occurrence | Retry creates one obligation |
| AP-012 | Payment proposals | Select due/discounted obligations and holds | Invalid beneficiary excluded |
| AP-013 | Payment release | Freeze beneficiary/amount/revision | Bank change invalidates affected approval |
| AP-014 | Batch payment | Track each intent independently | Confirmed item not repeated after partial failure |
| AP-015 | Supplier deposits | Record and apply approved advances | Advance control reconciles separately |
| AP-016 | Withholding | Apply validated local deduction/remittance | Gross/net/tax totals reconcile |
| AP-017 | AP aging | Bucket outstanding by party/currency/date | Aging equals selected open liability |
| AP-018 | Early discounts | Apply approved eligibility/accounting | Expired discount cannot reduce liability |
| AP-019 | Supplier statements | Compare external/internal evidence | Variance links missing/duplicate facts |
| AP-020 | Payment holds | Restrict disputed/compliance/treasury items | Held item excluded from auto-payment |
| AP-021 | Refund recovery | Track supplier refund against eligible credit | Credit extinguished once |
| AP-022 | AP reconciliation | Tie allocations/FX/open items to control | Differences expose source records |

## Screens, roles and reports
Provide task workspace; scoped searchable list; detail/editor; approval or execution panel; source links; timeline; import/export; settings and contextual help. Implement relevant [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) patterns. Dashboard definitions, date/currency context and source drill-through follow [REPORTING.md](../REPORTING.md). Permissions separate view/edit/approve/execute/post/reverse/export/admin, including sensitive fields and entity scope.

## Automation and integration
Events are emitted only after committed commands through the outbox. Automate reminders, routing, validated proposals and exception queues; financially material execution inherits [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Each connector gets scoped credentials, idempotency, unknown-outcome reconciliation, effective policy versions and capability-specific tests. Imports go through the same command invariants; never direct-write balances.

## Failure, retention and lifecycle
Domain regression cases: Duplicate OCR invoice; beneficiary edit; competing credits; partial bank batch.
Also test forbidden scope, stale revisions, duplicate command/event, unavailable dependency and worker restart. Financial corrections preserve facts; protected records obey [SECURITY.md](../SECURITY.md) and local retention. Enable validates dependencies/configuration/country readiness. Disable drains new work, handles open obligations and retains authorized historical/correction access; it never deletes facts. Register a versioned manifest per [MODULE-CONTRACT.md](../MODULE-CONTRACT.md).

