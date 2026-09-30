# Receivables, invoicing and collections

**Module ID:** ar-billing  
**Prefix:** AR  
**Readiness:** planned; feature-level verification required  
**Personas:** Billing clerk, collections specialist, accountant  
**Hard dependencies:** [platform](platform.md), [finance-gl](finance-gl.md), [tax-compliance](tax-compliance.md)

## Purpose and workflow
Bill -> approve/post -> collect -> allocate -> reconcile -> credit/refund.

## Owned entities
Invoice, credit/debit note, open item, receipt, allocation, advance, dispute. Fields/physical schemas are elaborated for the selected release slice under [DATA-MODEL.md](../DATA-MODEL.md).

## Controls and boundaries
Posting, fulfillment and settlement states separate; allocation and credit entitlement serialized.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and applicable financial/design/localization rules. Operational-only and financial modes must be explicit; optional integrations require their own readiness.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| AR-001 | Invoice entry | Support goods/services/source lines and exact totals | Components sum to posted total |
| AR-002 | Partial billing | Bill remaining source quantities/milestones | Same entitlement cannot rebill |
| AR-003 | Terms/installments | Snapshot due schedules and approved terms | Later term edit preserves issued schedule |
| AR-004 | Recurring billing | Generate approved schedule occurrences | Duplicate occurrence creates one invoice |
| AR-005 | Debit notes | Increase obligation with linked reason | Balanced authorized journal created |
| AR-006 | Credit notes | Reduce original eligible lines/amounts | Concurrent credits cannot exceed source |
| AR-007 | Advances | Record unapplied cash separately | Advance not prematurely recognized as revenue |
| AR-008 | Receipts | Record cash/bank/provider receipts | Duplicate provider reference creates one receipt |
| AR-009 | Allocations | Apply permitted currency/priority policy | Concurrent application cannot overallocate |
| AR-010 | Dunning | Assign staged overdue follow-up | Holds/disputes follow exclusion policy |
| AR-011 | Statements | Show movement/allocation/running balance | Statement agrees with as-of subledger |
| AR-012 | Aging | Bucket eligible outstanding by due/date basis | Buckets sum to selected open balance |
| AR-013 | Credit exposure | Evaluate invoices/orders/deposits by policy | Competing releases honor limit |
| AR-014 | Disputes | Track owner/evidence/collection hold | Hold does not erase receivable |
| AR-015 | Write-offs | Approve eligible bad-debt adjustments | Unauthorized write-off fails |
| AR-016 | Refunds | Issue authorized intent against refundable credit | Repeated intent cannot over-refund |
| AR-017 | Withholding evidence | Apply reviewed certificates/tax mapping | AR and tax control reconcile |
| AR-018 | Deferred revenue | Separate billing from recognition | Recognition bounded by contract basis |
| AR-019 | Document issue | Version PDF/delivery evidence | Delivery retry creates no new invoice |
| AR-020 | Late charges | Apply reviewed contract/local policy | Waiver and charge audited separately |
| AR-021 | Receipt reversals | Link accounting correction and bank reality | Reversal cannot claim returned bank funds |
| AR-022 | AR reconciliation | Compare subledger/FX/control ledger | Variance identifies source and date |

## Screens, roles and reports
Provide task workspace; scoped searchable list; detail/editor; approval or execution panel; source links; timeline; import/export; settings and contextual help. Implement relevant [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) patterns. Dashboard definitions, date/currency context and source drill-through follow [REPORTING.md](../REPORTING.md). Permissions separate view/edit/approve/execute/post/reverse/export/admin, including sensitive fields and entity scope.

## Automation and integration
Events are emitted only after committed commands through the outbox. Automate reminders, routing, validated proposals and exception queues; financially material execution inherits [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Each connector gets scoped credentials, idempotency, unknown-outcome reconciliation, effective policy versions and capability-specific tests. Imports go through the same command invariants; never direct-write balances.

## Failure, retention and lifecycle
Domain regression cases: Concurrent receipts; repeated schedule; excessive credit; unknown payment outcome.
Also test forbidden scope, stale revisions, duplicate command/event, unavailable dependency and worker restart. Financial corrections preserve facts; protected records obey [SECURITY.md](../SECURITY.md) and local retention. Enable validates dependencies/configuration/country readiness. Disable drains new work, handles open obligations and retains authorized historical/correction access; it never deletes facts. Register a versioned manifest per [MODULE-CONTRACT.md](../MODULE-CONTRACT.md).

