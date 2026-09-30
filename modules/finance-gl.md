# General ledger, accounting and close

**Module ID:** finance-gl  
**Prefix:** GL  
**Readiness:** planned; feature-level verification required  
**Personas:** Accountant, controller, CFO, auditor  
**Hard dependencies:** [platform](platform.md)

## Purpose and workflow
Configure -> approve opening -> post -> reconcile -> adjust -> close -> report.

## Owned entities
Book, period, account, mapping, journal, line, allocation, close evidence. Fields/physical schemas are elaborated for the selected release slice under [DATA-MODEL.md](../DATA-MODEL.md).

## Controls and boundaries
Leaf-only posting, immutable journal facts, exact balance, protected control accounts and guarded periods.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and applicable financial/design/localization rules. Operational-only and financial modes must be explicit; optional integrations require their own readiness.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| GL-001 | Four-level COA | Create class/group/subgroup/leaf hierarchy | Parents and cycles reject posting |
| GL-002 | Account lifecycle | Approve classification/currency/effective changes | Used account cannot be deleted |
| GL-003 | Mapping studio | Resolve entity/book/purpose/category mappings | Missing or ambiguous mapping blocks posting |
| GL-004 | Manual journals | Validate multi-line exact debit/credit entry | Unbalanced journal cannot post |
| GL-005 | Recurring journals | Schedule approved templates with occurrence key | Replay creates one journal |
| GL-006 | Accrual reversals | Schedule linked future reversal | Amount/dimensions mirror original |
| GL-007 | Journal approval | Bind review to source and configuration version | Material edit invalidates approval |
| GL-008 | Parallel books | Apply reviewed per-book accounting policies | Required book omission detected |
| GL-009 | Period control | Support open/soft/hard close and reopen | Unprivileged closed-period posting fails |
| GL-010 | Period guard | Serialize posting against close | Concurrent close admits no late journal |
| GL-011 | Dimensions | Validate project/branch/cost-center combinations | Invalid combination rejected |
| GL-012 | Allocations | Distribute approved pools by drivers | Distributed sum equals source exactly |
| GL-013 | Intercompany | Create linked paired entity purposes | Unmatched sides shown as exception |
| GL-014 | FX revaluation | Use approved rate and revaluation basis | Replay/reversal does not double-revalue |
| GL-015 | Accruals | Record supported unpaid obligations | Already recognized invoice not accrued twice |
| GL-016 | Prepayments | Amortize dated approved prepaid basis | Schedule cannot exceed eligible amount |
| GL-017 | Suspense | Assign aging/owner/resolution evidence | Unresolved policy breach blocks close |
| GL-018 | Opening balances | Load GL and supporting subledgers | Trial balance and controls reconcile |
| GL-019 | Trial balance | Report opening/movement/closing | Debit-credit difference exactly zero |
| GL-020 | Statements | Map balance sheet/income/cash-flow definitions | Totals drill to ledger population |
| GL-021 | Account ledger | Show dated movements and running balances | Opening plus movement equals closing |
| GL-022 | Close workspace | Collect required reconciliations and sign-off | Missing required evidence blocks close |
| GL-023 | Reopen | Require reason and authorized approval | Prior published report stays reproducible |
| GL-024 | Correction | Link reversal and replacement | Posted history never overwritten |
| GL-025 | Budget checks | Validate commitments under approved policy | Competing commitments cannot overspend |
| GL-026 | Audit export | Export permitted books/rules/evidence | Output states date/book/definition version |
| GL-027 | Rebuild balances | Recompute projections from facts | Rebuild agrees with ledger |
| GL-028 | Policy versioning | Freeze revenue/cost/valuation decisions | Changes affect future eligible postings |

## Screens, roles and reports
Provide task workspace; scoped searchable list; detail/editor; approval or execution panel; source links; timeline; import/export; settings and contextual help. Implement relevant [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) patterns. Dashboard definitions, date/currency context and source drill-through follow [REPORTING.md](../REPORTING.md). Permissions separate view/edit/approve/execute/post/reverse/export/admin, including sensitive fields and entity scope.

## Automation and integration
Events are emitted only after committed commands through the outbox. Automate reminders, routing, validated proposals and exception queues; financially material execution inherits [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Each connector gets scoped credentials, idempotency, unknown-outcome reconciliation, effective policy versions and capability-specific tests. Imports go through the same command invariants; never direct-write balances.

## Failure, retention and lifecycle
Domain regression cases: Close/post race; duplicate source; parent/control posting; FX reversal.
Also test forbidden scope, stale revisions, duplicate command/event, unavailable dependency and worker restart. Financial corrections preserve facts; protected records obey [SECURITY.md](../SECURITY.md) and local retention. Enable validates dependencies/configuration/country readiness. Disable drains new work, handles open obligations and retains authorized historical/correction access; it never deletes facts. Register a versioned manifest per [MODULE-CONTRACT.md](../MODULE-CONTRACT.md).

