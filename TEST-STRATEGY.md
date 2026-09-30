# Verification and definition of enterprise readiness
This pack is a specification. None of the ERP runtime tests below have been run because no implementation is included.

## Test layers
| Layer | Essential coverage |
| --- | --- |
| Domain/unit | Exact money, tax/FX/rounding, UOM, entitlement, calendar, approved rule calculations |
| PostgreSQL integration | Constraints, actual RLS/runtime roles, locks/isolation, immutable facts, rollback and period guards |
| Contract | Command/error schemas, native/API compatibility, event versions and adapter capabilities |
| Workflow | Retries, dedupe, partials, lease/crash recovery, unknown outcomes, compensation and approvals |
| E2E | Complete role flows including failure/correction/source chains |
| Security | Object/field/scope denial, SoD, injection, SSRF, upload/webhook/native boundary, AI tool access |
| Accessibility | Automated plus manual keyboard, screen reader, zoom, reflow, touch, contrast and reduced motion |
| Visual | Shared components/reference flows with long/translated/realistic data, every important state |
| Migration | Dry run, invalid rows, replay, openings/subledger reconciliation, source lineage |
| Performance | Published hardware/dataset/concurrency/query mix; p95/p99 and resource/locking measurements |
| Recovery | Clean-host restore, key/file/identity/build recovery, provider effect reconciliation |
| Localization | Independent expected fixtures, applicability/effective dates, provider sandbox and specialist sign-off |

## Golden end-to-end scenarios
- Order -> reserve -> partial shipment -> invoice -> receipt -> allocate -> return/credit/refund.
- Request -> budget -> RFQ -> PO -> accepted/held receipt -> matched invoice -> partial payment -> reconcile.
- Production -> component issue -> partial output/scrap -> quality release -> WIP settlement -> sale/recall.
- Project -> BOQ baseline -> variation -> progress certificate -> retention/advance recovery -> final account.
- Hire -> time/leave -> midcycle pay change -> pay-run review -> GL -> partial provider batch -> remit/reconcile -> exit.
- Client setup -> import -> close -> backup -> clean-host restore -> disconnected console -> continue operations.
- Demo select -> resolve -> provision/domain/seed -> verify -> expire/reset with production isolation.

## Property/invariant tests
Base journal debits equal credits; control subledgers equal GL; movement/rebuilt stock agrees; reservation <= eligible availability unless explicit validated exception; allocations/credits bounded; schedules preserve approved bases; posted correction retains history; source posting key unique; every data path scopes records. Generate varied dates/currencies/partials/retries, not only fixed happy paths.

## Concurrency fixtures
Two receipts allocate same invoice; two refunds claim same credit; two orders reserve last stock; two PO call-offs use same contract limit; close races journal posting; two workflow workers own one intent; two demo provisions claim one slug. Tests run with real overlapping transactions and prove final state, not merely mock lock calls.

## Financial acceptance values
Reviewed examples in examples/posting-cases.md are artificial arithmetic fixtures, not country rates. Tax/payroll expected values come from localized approved sources and independent computation. Test currency scales, inclusive taxes, line/document residuals, settlement/revaluation, return after sale, landed cost after issue, effective mapping changes and migration dates.

## Release blockers
Any unbalanced posting; unresolved control difference; unauthorized scope/field access; duplicate payment/posting; unqualified advertised statutory capability; missing restore evidence; critical accessibility failure in primary flow; insecure support/native boundary; unsupported client customization migration. Lower-severity findings need recorded owner/due date and risk decision.

## Evidence
Requirement ID, implementation/build, test case/run, fixture version, reviewer, country scope and status. A screenshot or seeded demo is not financial/security evidence. Update REQUIREMENTS-TRACEABILITY.md with real evidence; never fabricate PASS for planned features. Document-only QA for this pack checks file/link/ID/dependency/sample arithmetic consistency; it does not verify a working ERP.

