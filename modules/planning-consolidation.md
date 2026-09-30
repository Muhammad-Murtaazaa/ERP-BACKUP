# Budgeting, planning, costing and consolidation

**Module ID:** planning-consolidation  
**Prefix:** EPM  
**Readiness:** planned; feature-level verification required  
**Personas:** FP&A, controller, group CFO  
**Hard dependencies:** [platform](platform.md), [finance-gl](finance-gl.md)

## Purpose and workflow
Plan -> approve -> monitor -> forecast -> consolidate -> explain.

## Owned entities
Budget/version, driver, scenario, group, ownership, elimination, report mapping. Fields/physical schemas are elaborated for the selected release slice under [DATA-MODEL.md](../DATA-MODEL.md).

## Controls and boundaries
Forecast never alters actuals; group books preserve member ledgers and elimination provenance.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and applicable financial/design/localization rules. Operational-only and financial modes must be explicit; optional integrations require their own readiness.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| EPM-001 | Budget versions | Preserve original/revised/approved plans | Draft cannot authorize spend |
| EPM-002 | Plan dimensions | Model account/entity/project/cost-center/time | Invalid intersections rejected |
| EPM-003 | Drivers | Version formulas/inputs and assumptions | Snapshot reproduces results |
| EPM-004 | Rolling forecast | Extend horizon without overwriting actuals | Actual historical facts unchanged |
| EPM-005 | Commitments | Reserve/release eligible budget | Concurrent requests cannot overspend |
| EPM-006 | Variance | Compare actual/commitment/plan | Drill population reconciles |
| EPM-007 | Cash planning | Distinguish accrual from cash timing | Timing assumptions visible |
| EPM-008 | Workforce planning | Model staffing with sensitive access | Planner cannot infer hidden salary |
| EPM-009 | Capital planning | Model purchase/depreciation/funding | Cash/accounting effects separate |
| EPM-010 | Cost allocations | Allocate pools by approved driver | Sum preserved exactly |
| EPM-011 | Profitability | Define product/project/channel cost basis | Inclusions and freshness visible |
| EPM-012 | Completion forecast | Model approved remaining project costs | Baseline retained |
| EPM-013 | Consolidation group | Version membership/control/ownership | As-of uses correct configuration |
| EPM-014 | Translation | Apply reviewed rate policies | Translation reserve reconciles |
| EPM-015 | Intercompany match | Compare paired entity facts | Mismatch surfaced before elimination |
| EPM-016 | Eliminations | Post group-only adjustments | Entity ledger unchanged |
| EPM-017 | Top-side journals | Approve group book corrections | No leak to member actuals |
| EPM-018 | Minority interest | Gate reviewed control/ownership treatment | Fixtures required before production |
| EPM-019 | Group reporting | Publish versioned statement pack | Totals trace to member facts |
| EPM-020 | Scenario comparisons | Compare what-if outcomes | Scenario clearly distinct from actual |

## Screens, roles and reports
Provide task workspace; scoped searchable list; detail/editor; approval or execution panel; source links; timeline; import/export; settings and contextual help. Implement relevant [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) patterns. Dashboard definitions, date/currency context and source drill-through follow [REPORTING.md](../REPORTING.md). Permissions separate view/edit/approve/execute/post/reverse/export/admin, including sensitive fields and entity scope.

## Automation and integration
Events are emitted only after committed commands through the outbox. Automate reminders, routing, validated proposals and exception queues; financially material execution inherits [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Each connector gets scoped credentials, idempotency, unknown-outcome reconciliation, effective policy versions and capability-specific tests. Imports go through the same command invariants; never direct-write balances.

## Failure, retention and lifecycle
Domain regression cases: Competing commitments; FX differences; intercompany mismatch; dated ownership.
Also test forbidden scope, stale revisions, duplicate command/event, unavailable dependency and worker restart. Financial corrections preserve facts; protected records obey [SECURITY.md](../SECURITY.md) and local retention. Enable validates dependencies/configuration/country readiness. Disable drains new work, handles open obligations and retains authorized historical/correction access; it never deletes facts. Register a versioned manifest per [MODULE-CONTRACT.md](../MODULE-CONTRACT.md).

