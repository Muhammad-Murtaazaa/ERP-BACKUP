# Four-level chart of accounts
Four levels are a product requirement, not a guarantee of accounting quality. Valid classifications, mappings, dimensions, posting controls and reconciliations create reliable accounts.

## Hierarchy contract
| Level | Role | Can post? | Example |
| --- | --- | --- | --- |
| L1 | Statement class | No | Assets |
| L2 | Group | No | Current assets |
| L3 | Subgroup | No | Cash and bank |
| L4 | Account | Yes, subject to control policies | Operating bank — PKR |

Exactly four levels in the standard UI/template; a general tree implementation may support other future packs but must enforce this installation's configured four-level policy. L1-L3 cannot carry transactions. L4 has no children. Code strings are identifiers/display conventions, not the source of hierarchy.

Fields: account_id, organization/entity/book policy, code, name/translations, parent_id, level, statement_class, normal_balance, posting_allowed, control_type, currency restriction, reconciliation policy, tax/report tags, required dimensions, effective dates, active status and approved change version. Validate same-organization parent, allowed level, acyclic hierarchy, unique code per configured scope and consistent classification.

## Proposed general template
This template illustrates cross-industry coverage. It is not a statutory Pakistan/US universal COA. Create actual bank, inventory, asset, tax and liability accounts during guided setup; map financial statements and local forms separately.

| L1 | L2 | L3 | Example L4 codes and posting accounts |
| --- | --- | --- | --- |
| 1 Assets | 11 Current assets | 111 Cash and bank | 111001 Cash on hand; 111002 Operating bank PKR; 111003 Operating bank USD; 111004 Cash clearing |
| 1 Assets | 11 Current assets | 112 Receivables | 112001 Trade AR control; 112002 Allowance for doubtful debts; 112003 Retention receivable; 112004 Employee receivable |
| 1 Assets | 11 Current assets | 113 Inventory | 113001 Raw materials; 113002 Work in progress; 113003 Finished goods; 113004 Trading inventory; 113005 Goods in transit; 113006 Inventory provision |
| 1 Assets | 11 Current assets | 114 Recoverable tax | 114001 Input sales tax; 114002 Withholding tax receivable; 114003 Tax adjustment clearing |
| 1 Assets | 11 Current assets | 115 Advances and prepayments | 115001 Supplier advances; 115002 Prepaid insurance; 115003 Prepaid service contracts |
| 1 Assets | 12 Non-current assets | 121 Property and equipment | 121001 Machinery cost; 121002 Office equipment cost; 121003 Vehicles cost; 121004 Construction in progress |
| 1 Assets | 12 Non-current assets | 122 Accumulated depreciation | 122001 Machinery accumulated depreciation; 122002 Office equipment accumulated depreciation; 122003 Vehicles accumulated depreciation |
| 1 Assets | 12 Non-current assets | 123 Intangible / right-of-use assets | 123001 Software intangible cost; 123002 Accumulated amortization; 123003 Right-of-use cost; 123004 ROU accumulated depreciation |
| 1 Assets | 12 Non-current assets | 124 Long-term investments | 124001 Investment in subsidiary; 124002 Long-term deposits |
| 2 Liabilities | 21 Current liabilities | 211 Payables and accruals | 211001 Trade AP control; 211002 GRNI; 211003 Accrued expenses; 211004 Retention payable |
| 2 Liabilities | 21 Current liabilities | 212 Tax payable | 212001 Output sales tax; 212002 Withholding tax payable; 212003 Payroll tax payable |
| 2 Liabilities | 21 Current liabilities | 213 Payroll and benefits | 213001 Net payroll payable; 213002 Benefit deductions payable; 213003 Employer contributions payable |
| 2 Liabilities | 21 Current liabilities | 214 Advances and deferred revenue | 214001 Customer advances; 214002 Deferred subscription revenue; 214003 Customer deposits |
| 2 Liabilities | 21 Current liabilities | 215 Current borrowing | 215001 Overdraft principal; 215002 Current loan principal; 215003 Accrued financing charges; 215004 Current lease liability |
| 2 Liabilities | 22 Non-current liabilities | 221 Long-term borrowing | 221001 Long-term loan principal; 221002 Long-term lease liability |
| 2 Liabilities | 22 Non-current liabilities | 222 Provisions / deferred tax | 222001 Approved provision; 222002 Deferred tax liability |
| 3 Equity | 31 Contributed capital | 311 Owner capital | 311001 Share/owner capital; 311002 Additional contributed capital |
| 3 Equity | 32 Retained earnings and reserves | 321 Retained earnings | 321001 Retained earnings; 321002 Approved reserve |
| 3 Equity | 33 Distributions and drawings | 331 Owner distributions | 331001 Owner drawings/distributions; 331002 Distribution settlement clearing |
| 4 Revenue | 41 Operating revenue | 411 Goods and services | 411001 Product sales; 411002 Service income; 411003 Project income; 411004 Subscription income |
| 4 Revenue | 41 Operating revenue | 412 Contra revenue | 412001 Sales returns; 412002 Sales discounts |
| 4 Revenue | 42 Other income | 421 Non-operating income | 421001 Financing income; 421002 Disposal gain; 421003 Other approved income |
| 5 Cost of sales | 51 Direct costs | 511 Goods costs | 511001 Product COGS; 511002 Freight allocated to sold goods; 511003 Inventory write-down expense |
| 5 Cost of sales | 51 Direct costs | 512 Service/project costs | 512001 Direct labor; 512002 Subcontract cost; 512003 Project materials |
| 5 Cost of sales | 52 Production variances | 521 Manufacturing variances | 521001 Purchase price variance; 521002 Material usage variance; 521003 Labor/overhead variance |
| 6 Operating expenses | 61 People costs | 611 Payroll expenses | 611001 Salaries; 611002 Employer benefits; 611003 Recruitment and training |
| 6 Operating expenses | 62 Administration | 621 General administration | 621001 Rent; 621002 Utilities; 621003 Professional fees; 621004 Software and telecom |
| 6 Operating expenses | 63 Selling expenses | 631 Sales and marketing | 631001 Marketing; 631002 Sales commissions; 631003 Delivery expense |
| 6 Operating expenses | 64 Depreciation / impairment | 641 Non-cash operating expenses | 641001 Depreciation; 641002 Amortization; 641003 Bad debt expense |
| 7 Other expenses | 71 Finance and exchange | 711 Financing charges | 711001 Financing cost; 711002 Bank charges; 711003 Realized FX loss; 711004 Unrealized FX loss |
| 7 Other expenses | 72 Other losses | 721 Non-operating losses | 721001 Disposal loss; 721002 Other approved loss |
| 8 Income tax | 81 Income tax expense | 811 Tax charge | 811001 Current income tax expense; 811002 Deferred income tax expense |
| 9 Technical accounts | 91 Clearing and suspense | 911 Controlled technical clearing | 911001 Migration clearing; 911002 Suspense; 911003 Rounding difference; 911004 Intercompany clearing |

Normal balances: assets and expenses usually debit; liabilities, equity and revenue usually credit; contra accounts have explicit opposite nature. Foreign-exchange gains may have separate income accounts instead of combining with losses. Technical accounts require close review and cannot make a broken journal appear valid.

## Dimensions and party detail
Departments, projects, branches, cost centers, products, channels, partners and warehouses are dimensions. Customers/vendors/employees belong in subledgers; do not create a GL account for every party by default. Bank accounts may map to separate L4 accounts for reconciliation. Dimensions have allowed combinations, effective dates and entity scope; unused dimensions must not burden users.

## Guided COA setup
Choose industry and accounting policy -> preview hierarchy -> import existing COA if needed -> map AR/AP/inventory/tax/payroll/banks/WIP/revenue purposes -> validate account types -> simulate representative postings -> approve -> load opening balances -> reconcile -> lock activation baseline.

Map external legacy codes to stable internal account IDs. Preserve source code in migration evidence. Reports use versioned reporting taxonomy, not fragile code-prefix guesses. Parent rollups always derive from child facts. Moving a used account to a materially different classification requires review and an explicit report-history/restatement policy; do not silently change published statements.

## Controls and tests
Reject posting to L1-L3, cycles, duplicate codes, missing parents, invalid normal balances/control types and incompatible book/entity mapping. Disable only unused future posting, preserving historical queries. A deleted account with transactions is prohibited. Trial balance, account ledger and financial statement drill-through must agree. Test same names/codes across entities, contra accounts, currencies, mapping ambiguity and effective changes.

