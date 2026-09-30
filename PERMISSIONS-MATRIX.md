# Roles, scopes and segregation matrix
These are role templates; actual names/users/scopes are assigned during onboarding. Deny-by-default, field permissions and organization/entity constraints apply to every row.

| Role | Typical grants | Prohibited default |
| --- | --- | --- |
| Client owner | Organization settings, appoint administrators, export/handover | Automatic payroll/payment override |
| Client administrator | Users, scoped roles, approved modules/configuration | Edit posted journals; invisible support access |
| Security administrator | SSO/MFA/service credentials/review | Approve own financial transactions |
| Controller | COA/mapping/close/review authorized journals | Unapproved beneficiary change/payment release |
| Accountant | Enter journals/reconcile/post under scope | Alter posted facts or locked period |
| AP clerk | Capture/match obligations, payment proposal | Own proposal final release |
| Treasury releaser | Approve/execute eligible payments | Modify unreviewed beneficiary |
| AR/billing clerk | Invoice/credit/receipt preparation | Excess refunds/write-offs |
| Sales operator | Quotes/orders/own accounts | Restricted margin override |
| Buyer | RFQ/PO within category/entity | Approve prohibited own request |
| Supplier administrator | Master qualification/bank-change request | Release own changed beneficiary payment |
| Receiver | Receive assigned warehouse stock | Override quality release |
| Picker/packer | Assigned scan/pick/pack | Edit valuation/account mappings |
| Stock controller | Counts/reasons/approved adjustments | Silent historical stock mutation |
| Planner/engineer | BOM/routing/plan/proposals | Change frozen released order silently |
| Quality approver | Inspection/disposition/release | Prohibited operator self-release |
| Project manager | WBS/budget/progress within projects | Unapproved commercial variation |
| Quantity surveyor | Measurements/certificates | Excess certification/restricted rates |
| Service dispatcher | Cases/appointments/technician assignment | Unauthorized customer charge |
| Technician | Assigned jobs/time/parts/evidence | Global finance or HR access |
| HR administrator | Employment lifecycle/scoped sensitive data | Payment release without separate grant |
| Payroll specialist | Frozen input/calculation/payslip | Own final disbursement release |
| Manager | Team requests/time/leave/reviews | Hidden salary/medical/employee cases |
| Employee | Own profile/leave/time/payslips | Others' sensitive information |
| Analyst | Governed datasets and own scopes | Raw SQL or sensitive aggregate inference |
| Auditor | Read evidence/reports within mandate | Mutate audited source |
| Automation identity | Explicit workflow actions/amount limits | Role elevation/unallowlisted tools |
| Supplier/customer portal | Own party records and allowed actions | Guess another party ID |
| Omnysync demo operator | Isolated demo create/reset/expire | Production reset/access |
| Omnysync support | Client-authorized scope/expiry | Persistent master access |
| Release manager | Signed artifacts/compatibility | Client runtime control without approval |

## Segregation rules
Requester vs approver; journal creator vs reviewer above limit; supplier bank changer vs verifier/payment releaser; payroll calculator vs approver/releaser; count recorder vs adjustment approver; inspection operator vs release under policy; workflow author vs publisher for high-impact automation; extension installer vs reviewer.

Bind decisions to source revision/configuration/beneficiary. Recheck actor eligibility at execution. Temporary SoD waiver has scope, reason, compensating control and expiry; not a permanent hidden superuser.

## Scope composition
Organization membership + legal entities + optional branches/warehouses/departments/projects + record ownership + sensitive-field grants + action + capability state. Explicit denial/SoD wins. Shared report/dashboard does not share underlying rights. Export/search/AI/jobs/native/portal paths use same policy. Aggregate inference controls depend on data classification.

## Permission test template
For every command/query: allowed own scope; forbidden other scope; hidden field; revoked identity; stale grant; delegated permitted/expired; conflicting role/SoD; disabled capability; source revision changed. Verify both UI feedback and actual API/database result.

