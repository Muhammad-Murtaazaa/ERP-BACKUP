# Reporting and metric semantics
Metric definition owns name, grain, source population, dimensions, business dates, time window, currency/conversion, inclusion/exclusion, formula, policy/version, owner, permission and refresh watermark.

## Required report families
| Domain | Reports and basis |
| --- | --- |
| GL | Trial balance, account ledger, journal register, balance sheet, income, cash flow, dimensions and period close |
| AR | Aging, statements, invoice register, unapplied advances, disputes, collections, credit exposure and AR-control reconciliation |
| AP | Aging, obligations, payment proposal/outcomes, supplier statements, GRNI, expenses, withholding and AP reconciliation |
| Banking / financing | Statement reconciliation, settled/restricted/clearing cash, scenario cash forecast, facility/principal/charges, covenants and distributions |
| Inventory / WMS | On-hand/available/held/transit, lots/serials, movement, aging/expiry, valuation/layers, adjustments/count accuracy, pick/receipt SLA |
| Sales / CRM | Pipeline, forecast, quote conversion, orders/backorders, billings, revenue, returns, commission and margin |
| Procurement | Commitments, RFQ comparison, spend, open/late PO, delivery/quality, price variance and supplier concentration |
| Manufacturing / quality | MRP pegging, capacity, consumption/yield/scrap, WIP/variance, traceability, inspection/nonconformance/corrective action |
| Projects / BOQ | Baseline/revised/actual/commitment, current/cumulative quantities, forecast-at-completion, billing/retention/advance/cash and final account |
| HR / talent | Effective headcount, movement/turnover, onboarding, recruitment funnel, skills, review/learning completion with sensitive-group controls |
| Time / payroll | Approved time/attendance/leave, payroll gross/net/deductions/employer costs, liabilities/remittance and bank/GL reconciliation |
| Assets / service | Cost/depreciation/disposal/reconciliation, maintenance/downtime/reliability, SLA/work order cost and warranty |
| Commerce | Usage/billing, MRR/ARR/churn definitions, deferred/recognized revenue, collection/chargebacks and channel performance |
| Automation / administration | Runs/retries/dead letters, unknown outcomes, savings with review costs, demo lifecycle/resource cost and readiness |

## Common semantic traps
Ordered sales != invoiced sales != earned revenue != cash collected. PO commitment != supplier invoice actual != bank outflow. Physical progress != recognized project revenue. On-hand != available. Gross payroll != employer total cost. Bank balance != unrestricted cash. A forecast is not an actual. Report definitions must state these distinctions in the field names/help.

## Financial reports
Include legal entity/group, book, accounting basis, business-date/as-of, transaction inclusion cutoff, currency/conversion rates, report/mapping version and reconciliation status. Approved issued packs retain output/data snapshot or deterministic population evidence. Parent account totals derive from journal facts, not editable stored rollups.

## Query and sharing controls
Row/field grants before aggregate; sensitive-group suppression where configured; bounded query cost; stable pagination; export current authorization; recipient recheck at scheduled delivery; expiring downloads; shared dashboard applies each viewer's scopes independently. Browser hiding is not authorization.

## Performance / freshness
Live authoritative reads for posting/settlement/close checks. Read models may power dashboards with visible last refresh. Materialized aggregations have rebuild/verification controls. Heavy exports asynchronous, monitored and cancellable before completion where supported. Stale replica must not label recently posted balance zero or final.

## Acceptance
For each report, compute a reviewed fixture independently, compare total and drill population, test date/timezone/FX/credit/reversal/late posting, test permission/sensitive group, export and recipient revocation. Label filters and page/selected/filtered totals explicitly. Charts always provide exact-value data alternative.

