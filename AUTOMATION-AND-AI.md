# Automation and AI operating policy
Build deterministic reliable workflows first. Add AI where uncertain extraction, summarization, forecasting or recommendations help; never substitute a model for ledger arithmetic or authorization.

## Autonomy policy
| Tier | Allowed default | Control |
| --- | --- | --- |
| A0 | Read/summarize authorized data | No mutation; protected retrieval |
| A1 | Draft documents/tasks/mappings | User reviews and activates |
| A2 | Bounded reversible nonfinancial actions | Approved service scope, rate/budget limits and audit |
| A3 | Deterministic low-risk financial preparation or posting under explicit policy | Source validation, configured authority, segregation, amount limits and tested cases |
| A4 | Payment release, payroll disbursement, statutory submission or material commitment | Explicit organization policy and accountable authorization; model output alone never sufficient |

A3 is optional per client, not on by default. Examples of a permitted rule may be a validated recurring journal or verified matched invoice; changes to configuration/beneficiary/source revalidate authority. A4 remains disabled in demos.

## Workflow structure
Typed trigger + conditions + versioned steps + wait/approval + execution policy + timeout/retry + reconciliation/compensation + owner and evidence. Published versions immutable; running instance retains version. Loops and event-trigger recursion bounded. Effective dates/timezones fixed; occurrences uniquely keyed. Capture actor, source revision, rules/mappings and approval. Workflow activity failure cannot roll back already committed external effects.

## Automation catalog
| Process | Useful automation | Required review / check |
| --- | --- | --- |
| AP | OCR extraction, duplicate checks, match suggestions, due proposals | Arithmetic/source/bank/approval and country validation |
| AR | Draft recurring invoices, dunning, receipt suggestions | Consent/dispute/credit/amount limits |
| Inventory | Reorder, expiry/shortage alerts, bin proposals | Stock policy and quantity recheck |
| Manufacturing | MRP proposals, capacity alerts, variance flags | Planner release and engineering/version checks |
| HR | Onboarding tasks, document expiry, input anomalies | Sensitive field scope and local policy |
| Payroll | Approved-input calculations/variance review | Qualified rules, approval, segregated payment |
| Projects | Commitment alerts, draft progress/cash forecast | Measurement entitlement and commercial approval |
| Logistics | Feed acquisition, ETA alerts, document extraction | Source confidence and trade/legal checks |
| Finance | Close reminders, approved schedules, anomaly signals | Reconciliation, period locks, accountant policy |

## AI execution boundary
Permission-filter data before retrieval. Documents, emails, websites and OCR text are untrusted inputs, never instructions. Tool API is an allowlist of typed commands with normal validations; no SQL/shell or unconstrained HTTP. Model cannot grant itself roles, change beneficiary, disable approval or create missing mappings in live finance. Return evidence, uncertainty and alternatives where useful. Confidence threshold alone is insufficient for invoice approval.

## Data/providers
Client approves model/provider/location, retention/training terms and permitted data classes. Offer private/self-hosted adapter where qualified. Protect prompts/outputs with minimization/redaction; sensitive HR and identity data opt-in only. Never place provider keys in web/mobile apps. Embedding/search access respects revocation and organization scope; no shared vector collection bypass.

## Reliability
At-least-once trigger dedupe; durable attempts/leases; bounded exponential backoff; dead-letter owner; manual repair tools; per-provider rate limits; token/action/cost budgets; pause/kill switch. Replay never repeats confirmed money movement. Record unknown outcomes and reconcile provider/reference. Compensation is a new authorized command. Support safe human takeover and workflow retirement.

## Evaluation and savings
Before enablement, benchmark extraction against reviewed documents, false positives/negatives, time saved including human review, unauthorized retrieval/tool attempts, injected instructions, hallucinated supplier/account and totals mismatch. Use held-out samples and record scope. Forecasts backtest by horizon with uncertainty. Savings reports include failed runs, rework, reviewer time and provider cost. No generic promise that AI makes ERP autonomous.

## Required tests
Duplicate trigger; changed approval source; recursive loop; calendar/DST occurrence; crash after provider action; timeout/unknown result; partial batch; malicious attached instructions; scope leak through retrieval; disallowed tool; quota exhaustion; model unavailable; pause during wait; version rollback. Every approved automation has owner, recovery procedure and measurable acceptance.

