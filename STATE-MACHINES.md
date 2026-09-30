# State machines and execution guards
State axes stay separate. These rules supplement module descriptions and logic.md.

| Aggregate / transition | Guard | Atomic effect / recovery |
| --- | --- | --- |
| Financial draft -> submitted | Valid payload and revision; required evidence | Freeze reviewable snapshot; task/outbox |
| Submitted -> approved | Eligible approver, SoD, current revision/rules | Approval hash/version and audit |
| Approved -> posted | Period guard, exact intent, mappings, scope | Source/subledger/journal/audit/outbox together |
| Posted -> corrected | Authorized linked source and valid date | New reversal/adjustment; original remains posted |
| Order -> released | Terms/credit/readiness and approved version | Eligible commitments/reservations |
| Released -> partially fulfilled | Bounded source quantity and stock/quality | Inventory and source entitlement together |
| Order remaining -> cancelled | No cancellation of already consumed entitlement | Release eligible reservation/commitment only |
| Receipt -> accepted | Valid source/quantity/quality policy | Physical/available/value states explicit |
| Production -> released | Approved frozen BOM/routing and resources | Freeze version; issue/operation availability |
| Production -> closed | Resolved cost/quality/output balance | WIP settlement and closing evidence |
| Pay run -> calculated | Frozen approved input and qualified local rules | Deterministic pay lines and exception summary |
| Pay run -> approved | Review/SoD/input hash | Approval evidence; no cash movement |
| Pay run -> posted | Valid book/period/mappings | Payroll GL/liabilities; no presumed bank completion |
| Intent -> authorized | Beneficiary/amount revision and entitlement | Durable provider execution authority |
| Intent -> sending | Lease and idempotency key | Provider call outside DB transaction |
| Sending -> confirmed | Verified provider evidence/dedupe | Settlement/allocation exactly once |
| Sending -> unknown | Timeout/ambiguous response | Hold/reconcile; no blind resend |
| Workflow -> waiting | Durable state and deadline | Resume by authorized signal/version |
| Workflow -> failed | Classified permanent/exhausted error | Dead letter with owner/repair evidence |
| Workflow -> cancelled | Source/version policy and effects inventory | Prevent future steps; separately authorize compensation |
| Module -> draining | Dependency impact validated | Block new roots, preserve controlled completion |
| Module -> read_only | Blockers resolved/retained correction plan | Historical/legal access persists |
| Demo -> ready | Seed/auth/TLS/reconciliation checks pass | Link/credentials available; demo badge |
| Demo -> reset | Demo-only role/target confirmed in permission boundary | Recreate synthetic state with durable progress |

## Race policies
Transition commands use expected_revision and source locks. Async approval of old version fails safely. Permission/capability/period/state rechecked at execution. Source state transition and committed accounting purpose are atomic. Provider and delivery statuses not inferred from document state.

## Terminal and history behavior
Posted/corrected sources remain queryable. Closed operational order may retain open payment/warranty obligations. Archived employee may have retained payslips. Disabled module may retain settlement/correction/historical capabilities. Retention/purge is a distinct policy-reviewed action.

## UI mapping
Status labels say what happened: Draft, Awaiting approval, Posted, Partially fulfilled, Payment pending, Payment outcome unknown, Held for inspection, Reconciled. Never label an authorized intent Paid. Show allowed next actions and unmet prerequisites.

