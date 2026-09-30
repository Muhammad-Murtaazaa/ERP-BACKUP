# Financial engine and control specification
These rules apply to every financially active module. Country rules and accounting treatments need qualified review; rates and statutory thresholds are not hardcoded here.

## Core accounting model
Support accrual accounting, multiple legal entities, functional currency per entity/book, transaction currency, reporting currency, fiscal calendars, accounting periods, dimensions and parallel books where required. Proposed first book supports ordinary trade/service accounting; advanced treatments are explicitly gated.

Journal header: organization/entity/book, posting date, document date, source identity and accounting purpose, transaction/base currencies, FX policy snapshot, approval and mapping version, reason, correlation, status and reversal link. Lines: posting account, debit or credit in base currency, transaction currency/amount when applicable, party/subledger reference, dimensions, tax tags and source line. No line may contain both debit and credit or a negative debit/credit. Zero lines are omitted except a specifically permitted non-value record outside the journal.

Journal base debits equal base credits exactly at the approved posting precision. Currency-wise balancing is required where journal policy applies; multi-currency clearing/FX entries explicitly balance functional currency. Do not assert that summing unrelated currency amounts is meaningful.

## Precision and currency
Use PostgreSQL NUMERIC and an exact decimal library. Proposed working fields: quantities NUMERIC(24,8), rates NUMERIC(24,12), unit prices NUMERIC(24,8), journal monetary amounts NUMERIC(24,8). These bounds are validated against target industries before implementation. Reject overflow, NaN, Infinity and unsupported scales; do not rely on implicit DB rounding.

Represent decimals as strings at API/UI/storage boundaries. Currency metadata defines valid settlement minor units, rounding increment and display; accounting working scale may be greater. Select and version line-vs-document tax rounding and half-up/half-even where relevant; apply mandated jurisdiction rules. Document residual distribution is deterministic and traceable. Rounding differences post to an explicit approved account with a configured limit; never hide an arbitrary balancing plug.

FX records identify currency pair, orientation, source, rate type, effective instant/date, approver and whether manual. Revaluation is distinguishable from settlement gain/loss. Historical posted rates are immutable. Reciprocal conversion cannot silently substitute another convention.

## Posting engine
Only the financial engine can create posted journals. Source modules propose typed accounting intents; the engine resolves effective mappings, validates and commits.
- Unique source key: organization, entity, book, source type/id, accounting purpose and source version. Reposting the same purpose returns the previous result or conflicts if the intent differs.
- Reject closed periods, inactive/non-leaf accounts, wrong account entity/book, invalid required dimensions, unapproved source revision and missing tax/mapping policies.
- Direct control-account posting is denied except documented migration/approved adjustment purpose with linked subledger reconciliation.
- Commit source transition, subledger fact, journal, audit and outbox together. A connector outage does not lose financial intent.
- DB constraints plus a controlled posting routine and deferred journal-balance validation enforce persisted invariants. Application-only balance checking is insufficient.
- Lock period guard and source in a consistent order. Use explicit row locks/serializable retry where necessary. Rerun the complete transaction on a serialization failure, never only the last statement.
- Posted tables deny ordinary UPDATE/DELETE. Hash chains can help detect changes but do not alone make data tamper-proof; separately protected audit/backup evidence is required.

## Account mapping
Mappings are by entity/book, accounting purpose, item/category, warehouse, customer/vendor class, cost center and country where needed. Resolve explicit priority and reject equally specific conflicting matches. Require leaf account, compatible account nature/control classification and all mandatory dimensions. Version and approve mappings; preview test vouchers before publishing. Posted facts retain chosen account IDs and mapping version. Changing a mapping affects future postings only; historical restatement is a controlled journal process.

## Subledger controls
AR = posted customer invoices/debits less credit notes, valid allocations and write-offs, plus explicit adjustments at the as-of date. AP mirrors supplier obligations. Reconcile each party/currency balance with its control account population and FX adjustments. Unapplied receipts/deposits are explicit liabilities or policy-approved balances, not forced allocations.
Inventory quantity ledger and value ledger reconcile to inventory control accounts by entity/book/location/item. WIP reconciles production/project balances. Payroll liabilities, asset cost/accumulated depreciation, financing principal/accrued charges, deferred revenue and tax control accounts each need their own reconciliation report.

## Posting patterns
Illustrative standard cases; accountant approves entity/book-specific treatments. Amounts exclude tax unless stated.
| Event | Debit | Credit | Important condition |
| --- | --- | --- | --- |
| Invoice for earned sale 100 + output tax 10 | AR 110 | Revenue 100; output tax payable 10 | Revenue policy may instead require deferral |
| Shipment with carrying cost 60 | COGS 60 | Inventory 60 | Cost recorded once at policy transfer point |
| Customer receipt 110 allocated | Bank/clearing 110 | AR 110 | Settlement and bank reconciliation distinct |
| Customer advance 40 | Bank/clearing 40 | Customer advances 40 | Later application uses linked reclassification |
| Accepted stock receipt 80 | Inventory 80 | GRNI 80 | Receipt valuation and match basis recorded |
| Matched supplier invoice 80 + recoverable tax 8 | GRNI 80; input tax 8 | AP 88 | Unrecoverable tax capitalized/expensed under policy |
| Supplier payment 88 | AP 88 | Bank/clearing 88 | Provider settlement creates appropriate clearing transition |
| Payroll expense 100 with deductions 15 | Salary expense 100 | Payroll payable 85; deductions payable 15 | Employer contributions handled separately |
| Production material issue 50 | WIP 50 | Raw material inventory 50 | Frozen order/BOM and actual lot consumption |
| Production completion 70 | Finished goods 70 | WIP 70 | Settlement records actual/standard cost variances |
| Depreciation 10 | Depreciation expense 10 | Accumulated depreciation 10 | Asset/book schedule approved |
| Loan drawdown 500 | Bank 500 | Loan principal liability 500 | Fees/discounts may change accounting treatment |
| Loan repayment principal 100 + charge 5 | Loan liability 100; charge expense/accrual 5 | Bank 105 | Principal, accrual and cash never conflated |

See examples/posting-cases.md for linked lifecycle checks. Bank clearing policy MUST prevent simultaneously counting pending and settled cash twice.

## Reversals and corrections
A full reversal mirrors every original base amount, dimension, account and historical FX basis on an allowed date, with original linkage. A correcting voucher records the intended replacement. Partial adjustments use allowed source documents such as credit notes and cannot exceed uncorrected quantities/amounts. Reversing a payment does not claim the bank returned funds. Subsequent source dependents are checked and unwind/reallocation is explicit.

## Period close and books
A period has open, soft_closed, hard_closed states plus authorized adjustment rules. Soft close restricts normal users but permits designated closing entries. Hard close prohibits postings until an audited reopen. Date comparisons use the entity's fiscal business date. Late postings in another period must show source/document/posting dates. Multi-book postings follow approved book policy; a book must not silently omit required source events.

Close checklist: subledger reconciliation; bank clearing; GRNI aging; inventory/WIP; payroll/tax; depreciation; accruals; prepayments; FX; intercompany; suspense; manual journal review; trial balance; financial statement checks. Record reviewer and evidence per step.

## Advanced finance scope
Budgeting, cash-flow forecasts, consolidation, elimination, ownership changes, revenue contracts, leases, joint ventures, cost allocations, multicurrency hedging records and lending servicing each have separately verified capabilities. IFRS/US GAAP report mappings and revenue/lease treatments require accounting policy packs and expert review. No generic toggle proves accounting-standard compliance.

## Required financial tests
Balanced/unbalanced and missing-mapping journals; currency rounding/FX orientation; leaf-only posting; entity isolation; closed period race; duplicate source/retry; immutable history; full and partial credits; concurrent receipts/payments; control account protection; backdated valuation; negative stock policy; GRNI matching; payroll postings; multiple books; consolidated eliminations; permission/segregation; deterministic opening balances; audit retention; disaster recovery with reconciled balances.

