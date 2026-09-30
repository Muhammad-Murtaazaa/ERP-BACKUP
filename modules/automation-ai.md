# Workflows, AI and integration orchestration

**Module ID:** automation-ai  
**Prefix:** AUT  
**Readiness:** planned; scope-specific verification required  
**Hard dependencies:** [platform](platform.md)

## Workflow and entities
Design -> simulate -> approve -> publish -> run/review -> reconcile -> version.
Owned entities: Definition/version, trigger, step, run, service identity, intent, inbox/outbox, evaluation. Separate operators, process owners, approvers, administrators and auditors; portal users access only their authorized party records.

## Controls
AI proposes; deterministic services authorize/validate; no arbitrary DB/shell execution.
All rows inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [SECURITY.md](../SECURITY.md), [logic.md](../logic.md) and relevant financial/localization rules.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| AUT-001 | Builder | Compose typed triggers/conditions/actions | Invalid dependency blocks publish |
| AUT-002 | Versioning | Freeze definition for active run | Edit creates separate version |
| AUT-003 | Event triggers | Consume scoped committed events | Repeated event one eligible run |
| AUT-004 | Schedules | Use timezone/calendar occurrence keys | DST/retry not duplicate |
| AUT-005 | Approval steps | Bind scope/revision/expiry | Changed source requires reapproval |
| AUT-006 | Simulation | Replay samples without effects | Live payment/filing disabled |
| AUT-007 | Durability | Persist waits/leases/attempts | Crash resumes committed state |
| AUT-008 | Action authority | Execute scoped service identity | Cannot escalate creator authority |
| AUT-009 | Retries | Classify errors and backoff | Confirmed financial effect not repeated |
| AUT-010 | Unknown outcome | Query/reconcile provider intent | Timeout not treated as rejection |
| AUT-011 | Compensation | Define authorized corrective action | History not edited |
| AUT-012 | OCR | Return fields/confidence/source evidence | Inconsistent totals require review |
| AUT-013 | Assistant | Draft/answer from authorized retrieval | Hidden payroll absent |
| AUT-014 | Tool allowlists | Expose typed bounded commands | Arbitrary SQL/shell inaccessible |
| AUT-015 | Prompt defense | Treat source text as untrusted | Injected instruction cannot call forbidden tool |
| AUT-016 | Autonomy tiers | Configure draft/bounded/review modes | Monetary action follows explicit policy |
| AUT-017 | Predictions | Show assumptions/uncertainty | Prediction not posted fact |
| AUT-018 | Anomalies | Flag review evidence | Alert not proof of fraud |
| AUT-019 | Model governance | Approve provider/model/data policy | Protected data not sent unapproved |
| AUT-020 | Connector health | Monitor lag/dead letters | Replay retains dedupe key |
| AUT-021 | Budgets | Limit tokens/actions/cost | Exhaustion safely pauses |
| AUT-022 | Savings | Compare baseline with review/rework | Measured assumptions disclosed |
| AUT-023 | Retention | Redact prompt/output logs | Secrets absent |
| AUT-024 | Pause switch | Stop new runs/drain active effects | Confirmed effects remain reconcilable |

## UI, reports and automation
Use scoped task workspace/list/detail/editor, accessible approval or execution panel, timeline, settings, authorized imports/exports and contextual help. [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) define shared behavior. [REPORTING.md](../REPORTING.md) governs metric definitions, date/currency basis and drill-through. Events use committed outbox facts; actions run scoped identities and durable intents under [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Optional adapters have explicit qualification and failure handling.

## Tests and lifecycle
Domain cases: Prompt injection; repeated trigger; stale approval; timeout after provider effect.
Also verify field/scope denial, duplicate event/command, stale revision, unavailable dependency, worker crash, conflicting effective date and retention. Schema/API detail is expanded during the chosen slice. Enable requires compatible dependencies/configuration/coverage. Disable drains outstanding work while retaining legal history and authorized correction/settlement. Specialized regulated capabilities remain unavailable until their separate gate passes.

