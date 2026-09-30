# Subscriptions, commerce and revenue contracts

**Module ID:** subscription-commerce  
**Prefix:** COM  
**Readiness:** planned; scope-specific verification required  
**Hard dependencies:** [platform](platform.md), [sales-orders](sales-orders.md), [ar-billing](ar-billing.md)

## Workflow and entities
Publish -> sell/subscribe -> fulfill/use -> bill/collect -> recognize/renew.
Owned entities: Catalog publication, channel order, subscription, usage, billing schedule, obligation, recognition. Separate operators, process owners, approvers, administrators and auditors; portal users access only their authorized party records.

## Controls
Contract billing and earned revenue separate; obligations/proration/local rules reviewed.
All rows inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [SECURITY.md](../SECURITY.md), [logic.md](../logic.md) and relevant financial/localization rules.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| COM-001 | Channel catalog | Publish approved items/prices | Restricted product not public |
| COM-002 | Order connectors | Import scoped external orders | External order creates once |
| COM-003 | Checkout | Revalidate price/tax/stock/payment | Stale cart cannot bypass policy |
| COM-004 | Plans | Version recurring/usage/tier terms | Existing contract keeps agreed version |
| COM-005 | Lifecycle | Activate/amend/pause/cancel/renew | Effective change preserves earned charge |
| COM-006 | Usage | Deduplicate source events | Replay not rebill usage |
| COM-007 | Tiers | Calculate approved graduated/volume basis | Boundary fixtures exact |
| COM-008 | Proration | Apply explicit date/rounding | Credit/rebill reproducible |
| COM-009 | Recurring billing | Generate schedule occurrence | Duplicate occurrence once |
| COM-010 | Trials | Track consent/notice/conversion | No unauthorized expiry charge |
| COM-011 | Collections | Use approved payment intent | Unknown outcome reconciled first |
| COM-012 | Dunning | Apply reviewed pause/reminder policy | Historical records accessible |
| COM-013 | Revenue obligations | Allocate approved consideration | Allocation sum preserved |
| COM-014 | Recognition | Recognize eligible dated/event basis | Cannot exceed obligation |
| COM-015 | Chargebacks | Link provider event/correction | Duplicate not overreverse |
| COM-016 | Channel availability | Publish governed stock promise | Checkout rechecks stale feed |
| COM-017 | Self-service | Expose party-scoped contracts/invoices | No raw card secrets |
| COM-018 | Commerce metrics | Define MRR/churn/GMV/revenue | Definitions distinct |
| COM-019 | Renewal forecast | Show uncertainty/commitments | Forecast not contractual fact |
| COM-020 | Local gate | Validate notices/tax/receipt scope | Unsupported geography labeled |

## UI, reports and automation
Use scoped task workspace/list/detail/editor, accessible approval or execution panel, timeline, settings, authorized imports/exports and contextual help. [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) define shared behavior. [REPORTING.md](../REPORTING.md) governs metric definitions, date/currency basis and drill-through. Events use committed outbox facts; actions run scoped identities and durable intents under [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Optional adapters have explicit qualification and failure handling.

## Tests and lifecycle
Domain cases: Duplicate usage; midperiod cancel; chargeback; repeated external order.
Also verify field/scope denial, duplicate event/command, stale revision, unavailable dependency, worker crash, conflicting effective date and retention. Schema/API detail is expanded during the chosen slice. Enable requires compatible dependencies/configuration/coverage. Disable drains outstanding work while retaining legal history and authorized correction/settlement. Specialized regulated capabilities remain unavailable until their separate gate passes.

