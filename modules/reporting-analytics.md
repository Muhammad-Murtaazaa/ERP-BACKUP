# Dashboards and reporting

**Module ID:** reporting-analytics  
**Prefix:** BI  
**Readiness:** planned; scope-specific verification required  
**Hard dependencies:** [platform](platform.md)

## Workflow and entities
Define -> build -> validate -> publish -> drill/export -> revise.
Owned entities: Dataset, metric/version, report/version, layout, schedule, export, watermark. Separate operators, process owners, approvers, administrators and auditors; portal users access only their authorized party records.

## Controls
Authorization at query/delivery; currency basis explicit; totals reproducible.
All rows inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [SECURITY.md](../SECURITY.md), [logic.md](../logic.md) and relevant financial/localization rules.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| BI-001 | Datasets | Publish governed fields/relationships | Unauthorized fields excluded |
| BI-002 | Metrics | Define grain/time/currency/exclusions | Version visible |
| BI-003 | Dashboard builder | Configure accessible layout/filters | Widgets enforce source scope |
| BI-004 | Role templates | Provide useful task workspaces | Reset safe defaults |
| BI-005 | Report builder | Use governed joins/formulas | Arbitrary SQL prohibited |
| BI-006 | Financial packs | Produce approved statements/aging | Totals drill to source |
| BI-007 | Operational reports | Expose enabled domain metrics | Missing capability explanatory |
| BI-008 | As-of | Show date/refresh watermark | Late/stale effects labeled |
| BI-009 | Currencies | Require original/base/report policy | No implicit mixed sum |
| BI-010 | Drill-through | Preserve scope/filter | Population matches aggregate |
| BI-011 | Saved views | Share filters/columns | Recipient authorization reapplied |
| BI-012 | Scheduled delivery | Recheck recipient rights | Revoked recipient receives no export |
| BI-013 | Exports | Queue scoped expiring files | Current permission required download |
| BI-014 | Pivots | Bound multidimensional analysis | Query size limited |
| BI-015 | Forecast charts | Separate actual/plan/prediction | Uncertainty visible |
| BI-016 | Accessibility | Provide summary/data alternative | Exact values obtainable by keyboard |
| BI-017 | Quality flags | Expose missing/unreconciled data | Bad input not silently zero |
| BI-018 | Query policy | Centralize row/field scope | Custom report cannot bypass |
| BI-019 | Versioned output | Retain issued definition/parameters | Later edits not reinterpret output |
| BI-020 | Scaling | Use governed read models as needed | Authoritative reconciliation available |

## UI, reports and automation
Use scoped task workspace/list/detail/editor, accessible approval or execution panel, timeline, settings, authorized imports/exports and contextual help. [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) define shared behavior. [REPORTING.md](../REPORTING.md) governs metric definitions, date/currency basis and drill-through. Events use committed outbox facts; actions run scoped identities and durable intents under [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Optional adapters have explicit qualification and failure handling.

## Tests and lifecycle
Domain cases: Revoked scheduled recipient; salary inference; stale replica; currency mixing.
Also verify field/scope denial, duplicate event/command, stale revision, unavailable dependency, worker crash, conflicting effective date and retention. Schema/API detail is expanded during the chosen slice. Enable requires compatible dependencies/configuration/coverage. Disable drains outstanding work while retaining legal history and authorized correction/settlement. Specialized regulated capabilities remain unavailable until their separate gate passes.

