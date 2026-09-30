# Payroll, benefits and compensation

**Module ID:** payroll-benefits  
**Prefix:** PAY  
**Readiness:** planned; verify each enabled feature  
**Hard dependencies:** [platform](platform.md), [hr-core](hr-core.md), [time-workforce](time-workforce.md), [finance-gl](finance-gl.md), [tax-compliance](tax-compliance.md), [treasury-financing](treasury-financing.md)

## Workflow and owned entities
Validate rules -> freeze -> calculate -> review -> approve/post -> disburse/remit.
Entities: Pay calendar/component, election, pay run/line, deduction, liability, payslip, payment intent. Operators, reviewers, managers, administrators, employees/portal identities where relevant and auditors have separate scoped permissions; sensitive fields receive explicit grants.

## Invariants
Country/regional rules separately qualified; calculation/post/payment distinct.
Every feature inherits [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md), relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md) and [LOCALIZATION.md](../LOCALIZATION.md). Optional stock/provider integrations require declared capabilities; no implied certification.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| PAY-001 | Calendars | Define frequency/cutoff/pay date | Duplicate cycle obeys run policy |
| PAY-002 | Components | Classify earning/deduction/employer cost/tax | Unverified rule not live |
| PAY-003 | Salary/hourly | Use exact approved time/proration | Snapshot reproduces pay |
| PAY-004 | Variable pay | Import approved bonus/commission | Unapproved source unavailable |
| PAY-005 | Benefit enrollment | Track eligibility/elections/dates | Expired election not auto-continued |
| PAY-006 | Employer cost | Calculate approved contributions | Net vs employer total separate |
| PAY-007 | Statutory rules | Version federal/state/province/local logic | Rollover fixtures required |
| PAY-008 | Overtime/leave | Consume frozen reviewed calculations | No silent input changes |
| PAY-009 | Deductions | Enforce priority/caps/minimum net | Unsupported deduction exception |
| PAY-010 | Loan recovery | Apply approved outstanding | Concurrent run cannot overrecover |
| PAY-011 | Retro pay | Compute historical delta | Original payslip retained |
| PAY-012 | Off-cycle | Pay eligible adjustment/final amount | Source adjustment enters once |
| PAY-013 | Review | Show variance/exceptions/totals | Blocking issue prevents approval |
| PAY-014 | Approval | Bind input/rule/line hash | Edit invalidates authority |
| PAY-015 | GL allocation | Map expenses/liabilities/dimensions | Controls reconcile |
| PAY-016 | Posting | Create pay obligations/journal once | Retry idempotent |
| PAY-017 | Disbursement | Track employee intents/outcomes | Confirmed item not repeated |
| PAY-018 | Payslips | Issue confidential versioned breakdown | Employee sees own eligible record |
| PAY-019 | Remittances | Track tax/benefit settlement/evidence | Acceptance not presumed |
| PAY-020 | US reporting | Gate verified employee/contractor form scope | Only validated population enabled |
| PAY-021 | Pakistan reporting | Gate applicable tax/contribution scope | Regional/employee applicability explicit |
| PAY-022 | Final settlement | Apply reviewed local benefits/leave/notice | Uses approved rule snapshot |
| PAY-023 | Reconciliation | Tie gross/net/deductions/GL/bank | Differences identify cycle/employee |
| PAY-024 | Provider files | Secure supported formats/row evidence | Sensitive data not ordinary export |
| PAY-025 | Simulation | Compare protected historical what-if | Cannot post/send money |
| PAY-026 | Privacy | Restrict bulk pay/benefit/medical access | Aggregation cannot reveal hidden individual pay |

## UI, reporting and automation
Role workspace; scoped list/detail/editor; approval/execution review; source links; historical timeline; attachments; contextual help and authorized import/export. Use [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md). [REPORTING.md](../REPORTING.md) defines dates/currency/grain/freshness/drill-through. Emit committed events via outbox; reminders/routing/proposals and controlled actions follow [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Sensitive documents/data are excluded from broad search, logs and AI by default.

## Regression and lifecycle
Domain cases: Retro raise; midcycle exit; negative net; partial payment timeout.
Also test unauthorized field/scope access, stale edit, replay, invalid state/effective date, unavailable dependency, worker crash, retention/legal holds. Physical schemas/command payloads are elaborated for selected slices under [DATA-MODEL.md](../DATA-MODEL.md). Enable validates dependencies/configuration/local scope. Disable drains open obligations and retains authorized historical/settlement/correction access; never deletes source facts.

