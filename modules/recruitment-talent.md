# Recruitment, performance and learning

**Module ID:** recruitment-talent  
**Prefix:** TAL  
**Readiness:** planned; verify each enabled feature  
**Hard dependencies:** [platform](platform.md), [hr-core](hr-core.md)

## Workflow and owned entities
Plan/recruit -> offer -> onboard -> set goals -> review/develop -> succession.
Entities: Requisition, candidate, application, interview, offer, goal, review, course, certification, succession. Operators, reviewers, managers, administrators, employees/portal identities where relevant and auditors have separate scoped permissions; sensitive fields receive explicit grants.

## Invariants
Human hiring/performance review; protected traits excluded from automatic ranking.
Every feature inherits [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md), relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md) and [LOCALIZATION.md](../LOCALIZATION.md). Optional stock/provider integrations require declared capabilities; no implied certification.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| TAL-001 | Hiring requests | Approve headcount/job/budget | Unapproved role cannot publish |
| TAL-002 | Career portal | Collect accessible consented applications | Applicant sees own only |
| TAL-003 | Applicant tracking | Record stages/reasons | Decision authorized/attributable |
| TAL-004 | Candidate dedupe | Review linked identities | Consent/history preserved |
| TAL-005 | Interviews | Coordinate panel/timezone/provider | Reschedule evidence retained |
| TAL-006 | Scorecards | Use job-related criteria | Confidential notes scoped |
| TAL-007 | Offers | Approve terms/pay/signature | Acceptance binds version |
| TAL-008 | Checks | Use authorized minimal provider evidence | Unapproved check not initiated |
| TAL-009 | Hire conversion | Create onboarding once | Retry not duplicate employment |
| TAL-010 | Goals | Version measurable targets/alignment | Progress source visible |
| TAL-011 | Review cycles | Assign self/manager/peer workflows | Only assigned scope visible |
| TAL-012 | 360 feedback | Apply explicit privacy thresholds | No unsupported anonymity promise |
| TAL-013 | Calibration | Restrict review panels | Ordinary manager cannot enumerate notes |
| TAL-014 | Development | Assign actions/coaching/skills | Completion evidence required |
| TAL-015 | Learning catalog | Manage content/licensing/enrollment | Unlicensed content unavailable |
| TAL-016 | Assessments | Define attempts/pass criteria | Attempt policy enforced |
| TAL-017 | Certifications | Track issue/expiry/work eligibility | Expired eligibility gates assignment |
| TAL-018 | Succession | Protect readiness/key-position plans | Sensitive plans excluded from directory |
| TAL-019 | Merit reviews | Propose pay within budget | Draft not update payroll |
| TAL-020 | Talent analysis | Define funnel/skill/completion | Privacy grouping enforced |

## UI, reporting and automation
Role workspace; scoped list/detail/editor; approval/execution review; source links; historical timeline; attachments; contextual help and authorized import/export. Use [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md). [REPORTING.md](../REPORTING.md) defines dates/currency/grain/freshness/drill-through. Emit committed events via outbox; reminders/routing/proposals and controlled actions follow [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Sensitive documents/data are excluded from broad search, logs and AI by default.

## Regression and lifecycle
Domain cases: Consent deletion; duplicate application; confidential calibration; certification expiry.
Also test unauthorized field/scope access, stale edit, replay, invalid state/effective date, unavailable dependency, worker crash, retention/legal holds. Physical schemas/command payloads are elaborated for selected slices under [DATA-MODEL.md](../DATA-MODEL.md). Enable validates dependencies/configuration/local scope. Disable drains open obligations and retains authorized historical/settlement/correction access; never deletes source facts.

