# Reference screen and interaction specifications
Every screen inherits design-system.md and MODULE-CONTRACT.md. These are implementable layouts and acceptance behaviors; a finished Figma file or rendered application is not part of this documentation pack.

## 1. Role workspace
Top: organization/entity context, business date and one primary task. Below: exceptions requiring action, approvals and a small set of role KPIs. Main region: work queues with saved views. Finance sees unreconciled cash/overdue balances/close blockers; warehouse sees picks/receipts/shortages; HR sees onboarding/time approvals/pay-run exceptions. Dashboard customization is permission-aware, with Reset to role default. Empty state links to relevant onboarding step. Each KPI declares period, currency and freshness.

## 2. Invoice list
Context header: Invoices, entity, New invoice. Toolbar: search, date/status/customer filters, saved views, columns, export. Columns: invoice number, customer, date/due date, currency, total, outstanding, accounting state, settlement state and actions. No single ambiguous Paid/Unpaid flag hides credits. Filter chips are named and removable by keyboard. Bulk post shows eligible/ineligible count and errors per record. Export respects scoped permissions and visible-field policy.

## 3. Invoice editor and record
Header: document number/draft badge, customer and state axes; actions Save draft, Submit, Post based on role/state. Body: customer/address/date/currency/terms, line editor, attachments/comments. Right/bottom summary: exact totals, tax basis, open credit/advances, accounting preview. Line columns: item/service, description, quantity/UOM, price, discount, tax, amount; advanced dimensions in expandable row. Footer: source orders/shipments and approval history.

Post action presents entity/book/date, validation results and journal preview. A timeout reconciles command key instead of telling user to click again. Posted record shows immutable commercial snapshot, journal link, allocations and allowed credit/reversal actions. Invoice generation and payment collection are distinct actions.

## 4. Four-level COA / mapping studio
Left: accessible expandable tree; right: selected node details and balance/report classification. Parent nodes show derived totals and no posting toggle. L4 shows control type/currency/dimensions/use history. Search returns hierarchy breadcrumb. Create account wizard selects parent and validates level. Mapping studio lists accounting purposes, candidate account, conflicts and readiness. Publish requires simulated example vouchers and approval. Drag reparent has keyboard alternative and historical-impact warning.

## 5. Bank reconciliation
Three regions: statement lines, candidate ledger/clearing entries, match summary. Show statement opening/closing, ledger book balance and reconciliation difference with dates/currencies. Suggestions show reason and score; user can inspect source. Split match requires exact total. Unknown external payment outcome flagged. Finish reconciliation requires allowed unresolved-item treatment; never automatically write off a difference. Unmatch/reopen requires permission and reason.

## 6. Procurement / receiving
PO record shows ordered, received, returned, invoiced and remaining quantities by line. Receiving workflow scans/selects items, lots/serials, bin and quantity; shows overreceipt tolerance and inspection route. Submit allocates only accepted quantities to available stock; quarantine remains separate. Supplier invoice matching screen shows PO/receipt/invoice values side-by-side and separate exception resolutions.

## 7. Inventory / warehouse
Stock workspace distinguishes on-hand, reserved, available, quarantine and in-transit. Location/item/lot filters visible. Mobile receiving/picking uses one task/scan field, large confirmation and exception guidance. Serial duplicate shows previous location/status under authorization. Transfers show dispatch and receipt legs; unreceived stock remains in transit. Quantity adjustments require reason and resulting accounting preview.

## 8. HR employee / payroll
Employee detail separates directory data from sensitive compensation, bank, tax and medical/case data. Effective-date timeline avoids overwriting employment history. Pay-run workspace shows scope/cycle/rule version, ready/blocked people, gross/deductions/net/employer totals, variance from prior run and approvals. Review errors lead to affected records. Post/disburse distinct; app never displays hidden salary through totals, exports or global search.

## 9. Manufacturing work order
Header shows BOM/routing revision and planned/actual output. Tabs: materials/operations/quality/cost. Operators see current operation, required checks and consumption/completion action. Partial output and scrap have explicit fields. Component substitution requires authority and provenance. Close panel shows WIP reconciliation and unresolved quality/cost blockers. Mobile mode omits finance details unless granted.

## 10. Project / BOQ
WBS/BOQ tree with original/revised/certified/remaining quantities, budget/commitments/actuals, change order status and retention. Commercial rate access can differ from operational measurement access. Progress certificate compares this-period and cumulative quantities; prohibited duplicate certification shows source evidence. Project dashboard shows budget, forecast-at-completion and earned revenue under the selected policy.

## 11. Workflow studio
Choose trigger -> conditions -> actions -> approval/limits -> simulate -> publish. Canvas plus accessible step list. Expose typed inputs/outputs and version dependencies. Simulation uses historical/sample events without side effects. Run log shows successful, waiting, failed, skipped and unknown steps. Retry does not repeat an already-confirmed monetary action. Editing published workflow creates a version; running instances retain their defined version.

## 12. Omnysync demo console
Environments list: name/industry/modules/template/build/domain/owner/state/expiry. Create wizard: choose template, enabled capability set, dependencies, seed scenario, access and domain. Validation shows missing prerequisites and demo-only integrations. Provisioning displays phase with retryable evidence. Ready page offers copy link and role login choices with synthetic accounts. Reset/expire shows environment target prominently and cannot target client production.

## 13. Client admin / module management
Separate from Omnysync console. Users, roles, organization, modules, settings, audit, imports and authorized support. Toggle panel explains dependencies and capability status. Disable starts draining with pending document/job/connector counts and retained historical access. Client sees configuration diff and approval requirements. No hidden shared master password.

## 14. Dashboard / report builder
Select governed dataset -> dimensions/metrics -> filters -> chart/table -> permissions -> preview -> publish. Live field authorization before query execution. Accessible reorder/resize controls; drag optional. Publish warns about stale data, mixed currencies and missing filters. Financial report footer records entity/book/basis/as-of/currency and definition version. Scheduled recipients are individually authorized at delivery time.

## Required states for each screen
Loading; empty-first-use; empty-filtered; access denied; missing prerequisite; partial success; validation error; server error; integration outage; read-only/history; stale data; concurrent edit; offline draft; unsaved changes; background job completion. Document expected copy and recovery action. Do not show a blank panel for inaccessible data.

## Prototype acceptance exercise
Prototype five complete flows: invoice-to-receipt, PO-to-payment, receive-to-ship, onboard-to-payroll, create-to-reset-demo. Conduct usability tasks with realistic seeded records; record time, wrong turns, assistance, error recovery and completion. Test desktop/mobile flows appropriate to roles. Final screen implementations require visual inspection, not only specification approval.

