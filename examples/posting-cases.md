# Synthetic posting and reconciliation fixtures
All amounts, tax rates and FX rates below are artificial test inputs. They do not describe Pakistan/US statutory rules. Assume an approved accrual policy and correct mappings.

## Case A — Sale, partial receipt, return and completion
Invoice: net 100, artificial output tax 10, gross 110. Shipment cost 60. Receive 50. Return eligible net 20 + tax 2 with carrying cost 12. Receive remaining 38.
1. Invoice: Dr AR 110; Cr revenue 100; Cr output tax 10.
2. Ship: Dr COGS 60; Cr stock 60.
3. Receipt: Dr bank 50; Cr AR 50.
4. Credit: Dr sales returns/contra-revenue 20; Dr output tax 2; Cr AR 22.
5. Accepted return: Dr stock 12; Cr COGS 12.
6. Final receipt: Dr bank 38; Cr AR 38.

Expected: AR 0; net revenue 80; tax liability 8; net COGS 48; cash increase 88; stock net decrease 48; operating margin 32. Every journal base balances. Same credit/receipt key replay leaves totals unchanged. Over-credit/return beyond remaining source fails. Credit and physical acceptance can occur on different approved dates and states.

## Case B — Purchase receipt, invoice and payment
Receipt stock 80 -> Dr stock 80; Cr GRNI 80.
Supplier invoice 80 + artificial recoverable tax 8 -> Dr GRNI 80; Dr input tax 8; Cr AP 88.
Payment -> Dr AP 88; Cr bank 88.
Expected: stock +80, recoverable tax +8, bank -88, GRNI 0, AP 0. Any unmatched variance is explicit; no balancing plug.

## Case C — Foreign-currency settlement
Invoice 10 USD, base currency test rate 300 base units/USD -> Dr AR 3000; Cr revenue 3000.
Receive 10 USD at 310 -> Dr bank 3100; Cr AR 3000; Cr realized FX gain 100.
Expected: transaction obligation cleared; base AR 0; bank 3100; revenue 3000; FX gain 100. Historical invoice rate remains 300. Do not record revaluation and settlement gain twice.

## Case D — Payroll
Artificial gross earnings 100, employee deductions 15, net 85, employer contribution 10.
Dr payroll expense 100; Dr employer contribution expense 10; Cr payroll payable 85; Cr employee deduction payable 15; Cr employer contribution payable 10.
Employee payment: Dr payroll payable 85; Cr bank 85.
Remit reviewed liabilities: Dr employee deduction payable 15; Dr employer contribution payable 10; Cr bank 25.
Expected: total expense 110, bank -110, liabilities 0. Duplicate disbursement cannot send money again.

## Case E — Production
Issue raw materials 50: Dr WIP 50; Cr raw stock 50.
Approved labor/overhead 20: Dr WIP 20; Cr relevant liabilities/absorption account 20.
Receive output 70: Dr finished stock 70; Cr WIP 70.
Expected: WIP 0; finished goods 70; source consumption/completion unique. Scrap or incomplete output requires reviewed allocation/variance, not forced zeroing.

## Case F — Distributable basis
Artificial approved distributable basis 60, reserve 20, eligible distribution 40. Agreement A/B =70/30 -> approved allocations 28/12.
Exact GL treatment depends on reviewed entity/legal policy. If approved as owner distribution: Dr distribution/equity account 40; Cr partner payable A 28; Cr partner payable B 12. Pay authorized liabilities 28/12 through bank.
Expected: allocations total 40; reserve preserved; no expense assumed by generic percentage feature.

## Case G — Rounding and concurrency
Use synthetic prices 0.33333333 x quantity 3; apply configured working precision and explicit settlement rounding. Assert documented residual account/basis, never a hidden cent.
Two concurrent receipts attempt allocation 70 against invoice outstanding 100. One may allocate 70; second can allocate only remaining eligible 30 with its remainder unapplied or receive a policy conflict. Final AR/allocation cannot become negative.

## Case H — Closed period and provider outage
Lock period while invoice posting attempts same date. Shared guard makes one transition observe the other's committed state; no posting after hard close. A payment provider timeout leaves intent unknown; provider/reference lookup confirms or rejects before a new send. GL settlement and payment entitlement occur once after verified result.

These fixtures are starting tests, not a complete accounting-policy suite.

