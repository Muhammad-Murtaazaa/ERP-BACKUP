# Business logic and end-to-end process rules
Authoritative domain behavior. Financial detail is in FINANCIAL-CONTROLS.md.

## Command execution
1. Authenticate actor and resolve organization from trusted membership, not a request header alone.
2. Verify legal entity, module/capability status, role/scope/field permissions, segregation rules and delegation.
3. Validate payload and current revision. Normalize dates/UOM/decimal strings without losing source precision.
4. Claim scoped idempotency key with payload hash. A different payload under the same key is a conflict.
5. Begin unit of work; lock contested document, allocations, stock reservations, period guards and account configurations in defined order.
6. Revalidate command state, limits, effective rules and approval snapshot within the transaction.
7. Apply source transition plus authoritative inventory/subledger/journal facts, audit and outbox atomically.
8. Commit; record replayable response. Publish events asynchronously after commit.
9. External actions consume durable intents; failures update delivery status, not historical source amounts.

Example errors: PERMISSION_DENIED, MODULE_NOT_READY, INVALID_STATE, REVISION_CONFLICT, PERIOD_LOCKED, DUPLICATE_SOURCE, MAPPING_MISSING, STOCK_UNAVAILABLE, LIMIT_EXCEEDED, PROVIDER_OUTCOME_UNKNOWN. UI explains recoverable action without leaking protected records.

## State rules
Document, accounting, fulfillment, settlement and integration states are separate. An invoice can be posted, partially paid, fulfilled and awaiting statutory transmission simultaneously. Do not implement one overloaded status field.

| Object | Main transition path | Important branch |
| --- | --- | --- |
| Journal / financial document | draft -> submitted -> approved -> posted | rejected returns to revision; posted corrected by linked reversal |
| Sales order | draft -> approved -> released -> partially_fulfilled -> fulfilled -> closed | cancel only unfulfilled balance; preserve receipts/invoices |
| Purchase order | draft -> approved -> issued -> partially_received -> received -> closed | amendment creates version; obligations linked to original |
| Receipt / shipment | draft -> validated -> posted | correction must reconcile valuation and source quantities |
| Workflow | queued -> running -> waiting -> completed | retryable failure, dead letter, cancelled and unknown outcome explicit |
| Pay run | draft -> calculated -> reviewed -> approved -> posted -> disbursed | correction/off-cycle pay run; payment outcome tracked separately |
| Production order | planned -> released -> started -> partially_completed -> completed -> closed | scrap, rework and cancellation with WIP reconciliation |
| Demo environment | requested -> provisioning -> seeding -> verifying -> ready -> expiring -> archived | failed step retried without duplicate instances/domains |

## Order to cash
Lead -> qualification -> opportunity -> quote/version -> approved order -> reservation/credit check -> pick/pack/ship -> invoice -> payment -> allocation -> reconciliation -> return/credit if necessary. Users can start at invoice for permitted simple services, without inventing a shipment.
- Price, discount, tax, currency, terms, addresses and rule versions are snapshotted on approval/posting.
- Partial shipment and invoice track line-level ordered, fulfilled, billed, returned and cancelled quantities.
- Credit exposure includes policy-selected open invoices, orders and deposits; competing orders serialize the credit decision when required.
- Shipment creates inventory/COGS when control transfers under the approved policy; invoice creates revenue/AR or deferred amounts. Do not double-cost invoice and shipment.
- Overpayments become unapplied customer credit, not negative invoices. Refunds require approval and linked settlement.
- Returns validate original quantities, lot/serial, condition, disposition and refund/credit choice. Stock and revenue effects need separate accountable facts.

## Source to pay
Requisition -> approval/budget reservation -> RFQ -> bid comparison -> purchase order -> receipt/inspection -> supplier invoice -> two/three-way match -> approval/post -> payment proposal -> authorization -> provider execution -> bank reconciliation.
- No PO can be silently reapproved after material amendment; approved budgets/limits are re-evaluated.
- Accepted receipt creates stock and received-not-invoiced liability where policy applies. Invoice clears that accrual with explicit variance handling.
- Non-stock services need a service acceptance record or a permitted alternative, not a fictitious stock receipt.
- Match tolerances are scoped, effective-dated and approved; an exception cannot approve itself.
- Vendor bank changes invalidate pending payment approvals or require resubmission under policy.
- Returns and supplier credit notes link source receipts/invoices and prevent duplicate entitlement.

## Plan to produce
Forecast/orders -> master production plan -> MRP -> planned purchase/production proposals -> firm orders -> material issue -> operations/labor -> inspections -> completion -> WIP settlement -> finished stock -> cost variance -> close.
BOM/routing version is frozen at release. Replanning does not change released orders without an amendment. Multi-level explosion rejects cycles; UOM conversions and yields are explicit. MRP is a proposal generator, not an uncontrolled purchase executor. Completion cannot consume the same component twice after retry. By-product and co-product allocations follow an approved policy. Late costs trigger controlled valuation adjustments, not edits of shipped history.

## Project / construction to cash
Opportunity -> estimate/BOQ -> baseline contract -> WBS/budget -> resource and procurement commitment -> timesheets/material/subcontract measurement -> progress certification -> invoice/retention -> collection -> forecast-at-completion -> final account/defects/warranty.
BOQ commercial measured quantities differ from BOM manufacturing consumption. A change order affects approved scope/budget only after approval. Retentions, advances and recovery are explicit balances. Percentage completion/revenue policy requires accountant approval and country/book compatibility.

## Hire to retire
Headcount plan -> job requisition -> recruit/offer -> onboarding -> employment/compensation history -> time/leave/benefits -> payroll -> performance/learning -> transfer/promotion -> exit -> final settlement -> revoke access/return assets -> retention.
Employment status and login status are distinct. Employee records may exist without accounts. Rehire preserves previous service/history under policy. Sensitive changes are effective-dated; retroactive pay uses a correction calculation. Time approval, pay-run approval and payment release are separate permissions.

## Record to report
Source posting -> control reconciliations -> accrual/prepayment/depreciation/payroll -> FX revaluation -> intercompany reconciliation -> close checklist -> soft close -> hard close -> reports/consolidation -> authorized period reopen/correction.
Period closure acquires the same period guard as posting. A close cannot race with a late journal. Reopening has approval, reason and audit; exported statements retain their original as-of evidence.

## Service and asset operations
Ticket -> classify/SLA -> schedule -> field job -> parts/time -> customer acceptance -> invoice/warranty closure. Asset installation -> maintenance plan -> preventive/corrective order -> permit/safety checks -> labor/parts -> inspection -> close. Operational assets and fixed-asset accounting are linked but not identical.

## Financing and partner distributions
Treasury borrowing supports facilities, drawdowns, covenants, repayment, accruals and statements. Customer lending is a separately gated specialized pack. Cash forecasts distinguish bank availability, committed obligations, restricted cash and uncertain receipts. Recommendations show assumptions; AI does not decide capital adequacy.
Partner/shareholder allocation uses a versioned agreement, distributable basis, reserves, approved allocations and settlement. A profit share is not automatically an expense; equity/distribution/remuneration treatment is reviewed for the entity and jurisdiction. Never use a single generic percentage to replace legal/accounting policy.

## Canonical exception patterns
Stale edit: return latest revision and changed-field summary; never overwrite silently. Posted error: create linked correction with valid date and reason. External timeout: mark unknown, query provider/reference, reconcile before retry. Import partial failure: stage and show row errors, then commit approved batches; financial opening batch atomic by entity/book. Cancelled workflow after committed payment: compensation is a separate authorized refund, not transaction rollback.

## Cross-module invariants
Every source reference is scoped. Every authoritative amount has currency/book/date. Every balance-changing action is idempotent. Every stock allocation is bounded. Every approval covers a known document/configuration version. Every report total has an explainable population and as-of date. Every automated actor has narrower or equal authority to its approved service identity.

