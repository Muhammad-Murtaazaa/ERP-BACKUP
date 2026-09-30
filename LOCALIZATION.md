# Pakistan and US localization workstreams
Both countries are requested launch workstreams. A global core is not a worldwide tax/payroll engine. Coverage is enabled by individual capability + geography + entity/employee/product classification + effective date.

## Global/local split
Global: exact money, currencies, entity/books/calendars, four-level COA, source chains, audit, generic tax/benefit rule contracts, document templates, language and report taxonomy.
Local: applicability, tax bases/rates/thresholds, withholding, payroll calculations/remittances, mandatory invoice fields/timing, digital transmission, labor/leave/exit rules, statutory reports, customs and retention. No rates are hardcoded in this document.

## Country coverage register
Every entry MUST include country + regional/local scope; responsible specialist; official source and retrieved/effective dates; interpretation; rule/package version; supported classifications; fixtures including boundary cases; test evidence; approval; expiration/review date; integration qualification and known gaps. Status: researched -> specified -> implemented -> verified -> pilot -> production. Generic country flags cannot unlock every listed capability.

## Pakistan track
- Federal goods sales-tax/income-withholding applicability and entity/customer/item status.
- Provincial/territorial services tax and relevant registrations; separate authorities/rule scope.
- FBR digital invoicing/POS applicability, mandatory fields, submission/correction evidence and qualified integration path.
- Payroll income-tax treatment, eligible national/regional contributions/benefits and relevant employee classes.
- Effective employment, leave, overtime, exit/final settlement and retention policies for selected location/workforce.
- Currency/FX/document language; English default with validated Urdu/RTL patterns where requested.
- Customs/import-export classifications/documents and approved interfaces when trade pack selected.

FBR's public FAQ describes licensed-integrator requirements for relevant integrations and says governing law/rules prevail over its FAQ. Confirm entity applicability and current provisions with the client's specialist/integrator before live enablement. See [FBR FAQ](https://www.fbr.gov.pk/faqs/173967/173969) and [technical documentation portal](https://www.fbr.gov.pk/technical-documentation-di/163085/173959). This pack does not assert Omnysync holds an integrator license.

## US track
- Federal employer payroll responsibilities; withholding calculation data/rules; deposit/report correction workflow.
- Selected state/local payroll, unemployment, labor, leave and withholding; jurisdiction-specific scope, not all states inferred.
- Employee/contractor classification and verified reporting provider/form scope.
- Selected sales/use-tax nexus, sourcing, rates, exemptions and return integration.
- Customer/provider payment authorization, card security boundaries and contract/notice policies.
- US GAAP report/accounting policy options reviewed separately from IFRS configuration.
- Customs/trade documents and applicable consumer/lending rules for selected packs.

Use [IRS Publication 15](https://www.irs.gov/publications/p15) for employer-tax guidance and [Publication 15-T](https://www.irs.gov/publications/p15t) for federal withholding methods; neither alone establishes every state/local requirement.

## Local-rule delivery gates
Source review -> applicability matrix -> formulas/required data -> independently computed fixtures -> implementation -> matched results -> document/report reconciliation -> sandbox/provider qualification -> specialist sign-off -> bounded pilot -> production scope entry. Revalidate changes by effective date and keep old rule versions for historical reproduction.

## Required boundary fixtures
Hire/exit midperiod; annual/period wage thresholds; retro pay; negative net; leave carryover/expiry; exemption expiry; inclusive/compound tax; credit note after accepted transmission; foreign currency; missing identity; jurisdiction change; tax effective midnight; return amendment; statutory timeout/duplicate retry. Each country/regional feature owns expected values from authoritative policy rather than copying generic demo amounts.

## Operating model
Named localization owners for both countries from inception; parallel fixture/review queues. Providers/integrators may be the first live route while internal rule coverage expands. Release notes name the exact states/provinces/classifications and supported effective rule periods. Missing scope stays disabled with actionable onboarding guidance.

