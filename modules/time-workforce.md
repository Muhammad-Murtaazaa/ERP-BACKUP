# Time, attendance, leave and scheduling

**Module ID:** time-workforce  
**Prefix:** TIM  
**Readiness:** planned; verify each enabled feature  
**Hard dependencies:** [platform](platform.md), [hr-core](hr-core.md)

## Workflow and owned entities
Roster -> capture -> correct/review -> approve -> freeze pay inputs.
Entities: Punch, time entry, roster, shift, leave rule/balance/request, attendance exception. Operators, reviewers, managers, administrators, employees/portal identities where relevant and auditors have separate scoped permissions; sensitive fields receive explicit grants.

## Invariants
Local shift/timezone/DST explicit; effective labor rules; transparent device/location data.
Every feature inherits [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md), relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md) and [LOCALIZATION.md](../LOCALIZATION.md). Optional stock/provider integrations require declared capabilities; no implied certification.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| TIM-001 | Time clocks | Capture authorized web/mobile punches | Duplicate event once |
| TIM-002 | Device adapters | Map approved biometric/PIN identity | Unknown identity needs review |
| TIM-003 | Attendance | Calculate missing/late/break by policy | Overnight business date correct |
| TIM-004 | Timesheets | Record scoped project/service hours | Invalid overlap flagged |
| TIM-005 | Corrections | Approve before/after edits | Paid period uses retro correction |
| TIM-006 | Shift templates | Define work/break/overnight rules | Invalid duration rejected |
| TIM-007 | Rosters | Validate skills/capacity/rest | Hard conflict rejected |
| TIM-008 | Swaps | Approve eligible replacements | No forbidden coverage breach |
| TIM-009 | Overtime | Apply reviewed labor/policy rule | Approval cannot override statutory basis |
| TIM-010 | Leave accrual | Version carryover/expiry/proration | Balance reproducible |
| TIM-011 | Leave requests | Reserve/approve/cancel entitlement | Concurrent requests bounded |
| TIM-012 | Leave calendars | Show coverage safely | Sensitive reason hidden |
| TIM-013 | Holidays | Scope jurisdiction/location dates | Correct calendar applied |
| TIM-014 | Remote attendance | Collect transparent permitted location | No hidden continuous tracking |
| TIM-015 | Exceptions | Queue missing/overlap/rest issues | Blocking issue not payroll-ready |
| TIM-016 | Payroll freeze | Snapshot approved cycle inputs | Later edit not mutate run |
| TIM-017 | Project allocations | Export approved hours once | Same hour not double charged |
| TIM-018 | Staffing forecast | Compare demand/availability | Forecast not approve overtime |
| TIM-019 | Mobile actions | Capture leave/time/roster within scope | Offline intent revalidated |
| TIM-020 | Time metrics | Define utilization/attendance/overtime | Totals agree with approved population |

## UI, reporting and automation
Role workspace; scoped list/detail/editor; approval/execution review; source links; historical timeline; attachments; contextual help and authorized import/export. Use [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md). [REPORTING.md](../REPORTING.md) defines dates/currency/grain/freshness/drill-through. Emit committed events via outbox; reminders/routing/proposals and controlled actions follow [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Sensitive documents/data are excluded from broad search, logs and AI by default.

## Regression and lifecycle
Domain cases: Overnight DST; repeated punch; competing leave; edit after payroll.
Also test unauthorized field/scope access, stale edit, replay, invalid state/effective date, unavailable dependency, worker crash, retention/legal holds. Physical schemas/command payloads are elaborated for selected slices under [DATA-MODEL.md](../DATA-MODEL.md). Enable validates dependencies/configuration/local scope. Disable drains open obligations and retains authorized historical/settlement/correction access; never deletes source facts.

