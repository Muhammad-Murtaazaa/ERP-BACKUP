# Integration catalog and adapter qualification
Select provider/vendor by client geography, ownership, costs, data policy and available contracts. No provider choice here is a procurement recommendation.

| Adapter | Data/action | Required qualification |
| --- | --- | --- |
| Identity | OIDC/SAML/login/revocation | Issuer/claim mapping, tenant scopes, logout/MFA/recovery |
| Bank statements | File/API import | Formats, currency/timezone, dedupe, pagination, safe scopes |
| Payments | Authorized disburse/collect/refund | Provider idempotency/query, beneficiary freeze, webhook, settlement reconciliation |
| Pakistan invoicing | Applicable structured transmission/correction | Current provisions, qualified licensed-integrator route, sandbox and evidence |
| US tax/payroll | Selected calculations/filing/remittance | Jurisdiction/year/classification, independent fixtures and provider contract |
| E-sign | Signature/version/evidence | Identity, signing revision, evidence retention and legal scope |
| Carriers/maps | Booking/milestones/location | Approved source, rates, staleness, confidence and map license |
| Customs/broker | Classification/submission/status | Geographic authorization, references, unknown outcome |
| Storefront | Orders/catalog/availability | Source IDs, tax/price authority, webhook, oversell behavior |
| Card terminal | Tender authorization/capture | Certified provider device; raw card data outside ERP |
| Biometric/time device | Punch identity/time | Privacy, identity mapping, dedupe, timezone and outages |
| Scanner/scale/print | Operational input/output | Hardware/OS support, units/calibration, bridge permission and retries |
| Messaging/calendar | Notifications/scheduling | Recipient/source authorization, consent, retries and scopes |
| OCR | Fields/evidence/confidence | Held-out extraction quality, totals checks and human queue |
| AI/model | Authorized retrieval/draft/prediction | Data/provider policy, evaluation, injection/tool restrictions |
| Analytical export | Governed datasets | Row/field authorization, watermark, query limits and retention |

## Adapter record
ID/version, provider/contract owner, API/spec source/version, supported geography/currency/operations, data classes/residency, credentials scopes, sandbox endpoints, rate limits, timeout/retry, idempotency, query/reconciliation, webhook verification, error taxonomy, maintenance owner, cost/quotas, license and deprecation policy.

## Qualification tests
Valid/invalid payload; partial response; paginated history; expired credential; signature/replay; duplicate/out-of-order event; rate limit; provider timeout after side effect; amount/currency mismatch; beneficiary change; reference reconciliation; data redaction; client account handover. Unsupported provider behavior may force human confirmation rather than pretending exact-once execution.

## Independent ownership
Provider accounts/credentials belong to client unless explicitly delegated. Replacing Omnysync support must not lose carrier, bank, tax or model access. Adapter configuration exports placeholders; secrets transferred securely outside normal file exports.

