# Specialized financing and lending servicing

**Module ID:** lending-servicing  
**Prefix:** LND  
**Readiness:** planned; scope-specific verification required  
**Hard dependencies:** [platform](platform.md), [finance-gl](finance-gl.md), [tax-compliance](tax-compliance.md), [treasury-financing](treasury-financing.md)

## Workflow and entities
Qualify -> assess/review -> contract -> disburse -> service/collect -> reconcile/close.
Owned entities: Application, borrower, agreement, schedule, disbursement, collection, delinquency, impairment, regulatory evidence. Separate operators, process owners, approvers, administrators and auditors; portal users access only their authorized party records.

## Controls
Specialized gated pack; financial/consumer/lending authorization reviewed per geography; AI cannot solely approve credit.
All rows inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [SECURITY.md](../SECURITY.md), [logic.md](../logic.md) and relevant financial/localization rules.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| LND-001 | Product policy | Define validated financing product scope | Unreviewed geography unavailable |
| LND-002 | Applications | Collect consented minimal evidence | Applicant sees own only |
| LND-003 | Identity checks | Integrate authorized KYC providers | Result not assumed verified without evidence |
| LND-004 | Credit assessment | Record reviewed sources/decision factors | Human authority approves permitted decision |
| LND-005 | Agreements | Freeze approved financial terms | Signed terms immutable |
| LND-006 | Schedules | Calculate reviewed principal/charges/calendar | Exact approved obligation reconciles |
| LND-007 | Disbursement | Use segregated authorized intent | Retry not duplicate principal funding |
| LND-008 | Collections | Allocate receipts by approved priority | Concurrent receipt cannot overallocate |
| LND-009 | Prepayment | Apply reviewed payoff/fee/rebate policy | Source balances reconcile after settlement |
| LND-010 | Delinquency | Track dated arrears/notice/hold rules | No unsupported punitive action |
| LND-011 | Restructuring | Approve new terms and accounting treatment | Original contract/history retained |
| LND-012 | Impairment | Gate reviewed expected-loss/treatment model | No unvalidated automatic GL posting |
| LND-013 | Collateral | Link eligible pledged assets/evidence | Conflicting pledge rejected under policy |
| LND-014 | Statements | Show principal/charges/payments/as-of | Balance agrees with subledger |
| LND-015 | Regulatory data | Produce only validated jurisdiction reports | No claim of universal compliance |
| LND-016 | Closure | Reconcile zero/approved residual obligations | Unresolved provider intent blocks settlement close |

## UI, reports and automation
Use scoped task workspace/list/detail/editor, accessible approval or execution panel, timeline, settings, authorized imports/exports and contextual help. [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) define shared behavior. [REPORTING.md](../REPORTING.md) governs metric definitions, date/currency basis and drill-through. Events use committed outbox facts; actions run scoped identities and durable intents under [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Optional adapters have explicit qualification and failure handling.

## Tests and lifecycle
Domain cases: Unqualified jurisdiction; repeated disbursement; prepayment; restructuring with arrears.
Also verify field/scope denial, duplicate event/command, stale revision, unavailable dependency, worker crash, conflicting effective date and retention. Schema/API detail is expanded during the chosen slice. Enable requires compatible dependencies/configuration/coverage. Disable drains outstanding work while retaining legal history and authorized correction/settlement. Specialized regulated capabilities remain unavailable until their separate gate passes.

