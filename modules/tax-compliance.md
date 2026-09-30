# Tax and statutory interfaces

**Module ID:** tax-compliance  
**Prefix:** TAX  
**Readiness:** planned; feature-level verification required  
**Personas:** Tax accountant, localization specialist, reviewer  
**Hard dependencies:** [platform](platform.md), [finance-gl](finance-gl.md)

## Purpose and workflow
Scope -> validate rules -> calculate -> approve -> transmit -> reconcile/archive.

## Owned entities
Jurisdiction, registration, tax rule/version, certificate, return dataset, submission intent/response. Fields/physical schemas are elaborated for the selected release slice under [DATA-MODEL.md](../DATA-MODEL.md).

## Controls and boundaries
No universal hardcoded rates; live scope individually reviewed and qualified.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and applicable financial/design/localization rules. Operational-only and financial modes must be explicit; optional integrations require their own readiness.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| TAX-001 | Jurisdiction | Scope country/province/state/local registrations | Unsupported location remains gated |
| TAX-002 | Tax classes | Map party/item/service classifications | Missing class blocks statutory-ready action |
| TAX-003 | Effective rules | Version rate/base/threshold/rounding/source | Historical document retains version |
| TAX-004 | Inclusive tax | Calculate approved inclusive/exclusive basis | Exact totals reproduce |
| TAX-005 | Compound taxes | Apply explicit ordered bases | Ambiguous order rejected |
| TAX-006 | Exemptions | Validate certificate/scope/expiry | Expired certificate cannot auto-exempt |
| TAX-007 | Withholding | Determine eligible base/status/remittance | Gross/net/tax reconcile |
| TAX-008 | Recoverability | Map recoverable/expense/capital tax | Posting preview reflects approved treatment |
| TAX-009 | Return datasets | Aggregate validated period facts | Totals drill to documents |
| TAX-010 | Submission states | Track prepared/sent/accepted/rejected/unknown | Timeout never marked accepted |
| TAX-011 | Corrections | Link amendments and statutory references | Original evidence retained |
| TAX-012 | Pakistan invoicing | Use validated licensed-integrator path where applicable | Live transmission requires qualification |
| TAX-013 | US sales tax | Use selected verified jurisdictions/providers | Unsupported state remains gated |
| TAX-014 | Payroll tax | Version applicable national/regional/local rules | New version requires fixtures |
| TAX-015 | Submission evidence | Store safe request/response references | Sensitive fields protected |
| TAX-016 | Customs policy | Version approved codes and sources | Stale code triggers review |
| TAX-017 | Rule updates | Require provenance/dual review | Unreviewed draft unavailable live |
| TAX-018 | Tax reconciliation | Compare submitted/accepted/ledger totals | Rejected/unsubmitted amounts visible |
| TAX-019 | Compliance calendar | Assign due actions with owner | Reminder not treated as filing |
| TAX-020 | Readiness registry | Publish precise verified scope | Country flag cannot unlock untested rules |

## Screens, roles and reports
Provide task workspace; scoped searchable list; detail/editor; approval or execution panel; source links; timeline; import/export; settings and contextual help. Implement relevant [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) patterns. Dashboard definitions, date/currency context and source drill-through follow [REPORTING.md](../REPORTING.md). Permissions separate view/edit/approve/execute/post/reverse/export/admin, including sensitive fields and entity scope.

## Automation and integration
Events are emitted only after committed commands through the outbox. Automate reminders, routing, validated proposals and exception queues; financially material execution inherits [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Each connector gets scoped credentials, idempotency, unknown-outcome reconciliation, effective policy versions and capability-specific tests. Imports go through the same command invariants; never direct-write balances.

## Failure, retention and lifecycle
Domain regression cases: Rule rollover; exemption expiry; gateway timeout; transmitted correction.
Also test forbidden scope, stale revisions, duplicate command/event, unavailable dependency and worker restart. Financial corrections preserve facts; protected records obey [SECURITY.md](../SECURITY.md) and local retention. Enable validates dependencies/configuration/country readiness. Disable drains new work, handles open obligations and retains authorized historical/correction access; it never deletes facts. Register a versioned manifest per [MODULE-CONTRACT.md](../MODULE-CONTRACT.md).

