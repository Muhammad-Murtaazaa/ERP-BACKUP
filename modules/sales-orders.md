# Sales, pricing, CPQ and fulfillment

**Module ID:** sales-orders  
**Prefix:** SAL  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md), [ar-billing](ar-billing.md)

## Workflow and entities
Price -> quote -> approve -> order -> reserve/fulfill -> bill -> return/close.
Owned entities: Price list, quote/version, configuration, order, line, fulfillment allocation, return. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Line entitlement and revision are authoritative; service-only orders need no stock.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| SAL-001 | Price lists | Version customer/channel/currency/date prices | Inactive price unavailable |
| SAL-002 | Discounts | Configure priorities/caps/stacking | Ambiguous rules rejected |
| SAL-003 | CPQ | Validate option combinations/dependencies | Invalid configuration cannot order |
| SAL-004 | Quote versions | Retain revisions/validity/acceptance | Acceptance binds exact version |
| SAL-005 | Margin approval | Route price/margin exceptions | Restricted discount cannot release |
| SAL-006 | Orders | Convert quote or enter permitted order | Terms/source snapshot retained |
| SAL-007 | Credit release | Recheck policy exposure | Competing releases respect limit |
| SAL-008 | Promise dates | Compute supported stock/supply assumptions | Estimate distinguished from reservation |
| SAL-009 | Reservations | Request inventory allocation through contract | Available units not overreserved |
| SAL-010 | Partial fulfillment | Track ordered/fulfilled/returned/cancelled | Cannot exceed eligible quantity |
| SAL-011 | Backorders | Retain shortage and owner/date | Close cannot hide unresolved balance |
| SAL-012 | Drop shipment | Link supplier fulfillment evidence | No fake owned-stock movement |
| SAL-013 | Amendments | Version/reapprove material change | Prior fulfillment provenance retained |
| SAL-014 | Returns | Authorize original quantity/serial | Repeated return cannot duplicate entitlement |
| SAL-015 | Freight | Apply approved revenue/cost treatment | Invoice/margin basis reconcile |
| SAL-016 | Commissions | Accrue by defined sale/collection basis | Credit adjusts eligible commission |
| SAL-017 | Blanket sales | Track expiry and call-off limits | Concurrent call-offs bounded |
| SAL-018 | Sales analysis | Define orders/billings/revenue/margin | Booked and recognized remain distinct |
| SAL-019 | Portal | Expose scoped quotes/orders/invoices | Customer cannot enumerate others |
| SAL-020 | Signature adapter | Retain provider evidence | Signed revision cannot change silently |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: Partial cancellation; competing credit checks; discount overlap; repeated serial return.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

