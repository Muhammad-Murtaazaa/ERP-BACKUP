# Banking, treasury, financing and partner distributions

**Module ID:** treasury-financing  
**Prefix:** TRY  
**Readiness:** planned; feature-level verification required  
**Personas:** Treasury manager, CFO, accountant  
**Hard dependencies:** [platform](platform.md), [finance-gl](finance-gl.md)

## Purpose and workflow
Reconcile -> forecast -> authorize funding/payment -> settle -> accrue -> review.

## Owned entities
Bank account, statement, match, forecast, facility, drawdown, covenant, distribution agreement. Fields/physical schemas are elaborated for the selected release slice under [DATA-MODEL.md](../DATA-MODEL.md).

## Controls and boundaries
Distinguish cash/clearing/restricted balances, principal/charges and distributions; lending separately gated.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and applicable financial/design/localization rules. Operational-only and financial modes must be explicit; optional integrations require their own readiness.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| TRY-001 | Bank registry | Bind entity/currency/account/operators | Wrong-entity mapping fails |
| TRY-002 | Statement import | Parse supported files/APIs with evidence | Same external line imports once |
| TRY-003 | Matching | Suggest one/many matches with reasons | Suggestion never silently writes difference |
| TRY-004 | Split matching | Allocate exact bank line among entries | Matched sum equals line amount |
| TRY-005 | Reconciliation close | Review statement/ledger/difference | Unexplained difference cannot close |
| TRY-006 | Cash position | Separate available/restricted/clearing | Pending and settled cash not double-counted |
| TRY-007 | Cash forecast | Combine timed obligations and scenarios | Every forecast exposes source/assumption |
| TRY-008 | Liquidity alerts | Flag scenario shortages | Alert cannot authorize borrowing |
| TRY-009 | Bank transfers | Record linked legs and clearing | Retry cannot duplicate either leg |
| TRY-010 | Facilities | Track limit/currency/expiry/security | Excess eligible drawdown rejected |
| TRY-011 | Drawdowns | Record approved principal/fees | Cash/liability reconcile |
| TRY-012 | Repayment schedules | Version principal/charge/calendar basis | Amounts reconcile to approved principal |
| TRY-013 | Charge accrual | Accrue versioned financing terms | Occurrence retry posts once |
| TRY-014 | Covenants | Review thresholds and calculated evidence | Breach assigned to accountable reviewer |
| TRY-015 | Collateral | Track pledge/valuation/release | Policy prevents conflicting pledge |
| TRY-016 | Letters of credit | Track margin/documents/expiry/settlement | Expired/overdrawn facility held |
| TRY-017 | FX exposure | Report currency-specific obligations | Unrelated amounts not directly summed |
| TRY-018 | Partner agreements | Version distribution basis/reserves | Allocation binds approved agreement |
| TRY-019 | Distribution proposal | Calculate eligible reviewed amount | Cannot exceed approved distributable basis |
| TRY-020 | Distribution settlement | Apply approved equity/liability/expense policy | Payment links authorized allocation |
| TRY-021 | Lender statements | Reconcile principal/charges/evidence | Differences identify terms/source |
| TRY-022 | Customer lending gate | Require specialized validated servicing pack | Borrowing setup cannot enable lending |

## Screens, roles and reports
Provide task workspace; scoped searchable list; detail/editor; approval or execution panel; source links; timeline; import/export; settings and contextual help. Implement relevant [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) patterns. Dashboard definitions, date/currency context and source drill-through follow [REPORTING.md](../REPORTING.md). Permissions separate view/edit/approve/execute/post/reverse/export/admin, including sensitive fields and entity scope.

## Automation and integration
Events are emitted only after committed commands through the outbox. Automate reminders, routing, validated proposals and exception queues; financially material execution inherits [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Each connector gets scoped credentials, idempotency, unknown-outcome reconciliation, effective policy versions and capability-specific tests. Imports go through the same command invariants; never direct-write balances.

## Failure, retention and lifecycle
Domain regression cases: Duplicate line; unknown settlement; changed loan schedule; excessive partner distribution.
Also test forbidden scope, stale revisions, duplicate command/event, unavailable dependency and worker restart. Financial corrections preserve facts; protected records obey [SECURITY.md](../SECURITY.md) and local retention. Enable validates dependencies/configuration/country readiness. Disable drains new work, handles open obligations and retains authorized historical/correction access; it never deletes facts. Register a versioned manifest per [MODULE-CONTRACT.md](../MODULE-CONTRACT.md).

