# ADR-015 — Subscriptions bill in advance on anniversary; loan interest is cash-basis
Status: accepted • 1 October 2026

## Decision
**COM (subscriptions):**
- A subscription bills in advance for [next_bill_date, +interval).
- The billing run catches up missed periods, bounded by `max_periods`.
- Each (subscription, period_start) is unique in `com_billing_periods`, and the invoice `sourceKey` is `COM:<id>:<period_start>`, so re-runs and a rewound cursor cannot double-bill.
- Each subscription bills in its own transaction. A closed period fails only that subscription, and nothing is half-billed.
- The final period before `end_date` is prorated by days.
- Paused periods are not billed retroactively.
- Revenue posts to 411007 at invoice time. There is no deferral over the service period yet (COM-014).

**LND (customer financing):**
- The schedule is fixed at disbursement. Annuity uses a level payment; equal-principal is also supported. The last instalment absorbs rounding.
- Disbursement posts DR 112004 / CR 111002 once. Approval and disbursement need different users from origination.
- Repayments are allocated oldest instalment first, interest before principal, and post DR 111002 / CR 411006 / CR 112004.
- Interest is recognised when it is collected. There is no period-end accrual, penalty interest, impairment or restructuring.

## Consequences
- Both are simple and audit-friendly, and good enough for HVAC AMC plans and equipment instalments.
- Revenue deferral (IFRS 15 over-time) and interest accrual (IFRS 9 effective interest) are later work.

## Addendum (round 2, later): revenue deferral implemented

- Quarterly and annual subscription invoices now credit **211010 Deferred Revenue** instead of 411007 (migration 038).
- The billed net is allocated to calendar months by days, and the last month absorbs rounding (`allocateByMonth`). It is stored in `com_revenue_schedule`, one row per (billing period, month).
- Recognition (`POST /api/com/revenue/recognize`, and the daily COM-BILLING job after billing) posts DR 211010 / CR 411007 at each month end.
  - It posts one journal per line, with source key `COM_REV:<line>`.
  - The row is locked and marked RECOGNISED, so re-runs are no-ops.
  - Posting goes through the normal period guard.
- Monthly plans still recognise on invoice, since the deferral would be immaterial.
- Known gaps:
  - Cancelling mid-period doesn't credit or reverse unrecognised revenue. The remaining lines keep recognising.
  - There is no mid-period upgrade proration.

## Addendum 2 (round 2, final): cancellation, plan changes, loan automation and accrual

- **Cancellation (migration 041).** Cancelling a quarterly or annual plan settles its PENDING schedule lines as of `effective_date` (today or earlier) in one journal with key `COM_CANCEL:<id>`:
  - Lines that are already due are recognised as normal.
  - The current line is earned pro rata by days.
  - The unearned remainder goes to **211006 Customer Advances** (`REFUND`, the default) or to revenue (`FORFEIT`).
  - Settled lines are marked `RELEASED` and are never recognised again.
- **Plan change (migration 044).** `POST /api/com/subscriptions/:id/change-plan` works within the same billing cycle:
  - **Upgrade:** invoices `(new − old) × remaining/total days` of the current billed period at once, as an `UPGRADE` billing period. It is deferred and scheduled for quarterly and annual plans, and the plan switches immediately.
  - **Downgrade:** is queued (`pending_plan_id`) and applied by the billing run on the next bill date. No credit notes are issued.
  - Only one change per day is allowed.
- **Loans (migrations 040, 045).**
  - The `LND-LATE-FEES` A3 job assesses late fees daily.
  - With `lnd.interest_basis = ACCRUAL`, the job (or `POST /api/lnd/interest/accrue`) first accrues each instalment's interest on its due date: DR 112005 / CR 411006, once per instalment.
  - Collections credit 112005 for accrued instalments, and 411006 only for instalments that were not accrued.
  - CASH stays the default.
