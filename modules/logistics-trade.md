# Logistics, containers and international trade

**Module ID:** logistics-trade  
**Prefix:** LOG  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md), [sales-orders](sales-orders.md), [procurement](procurement.md), [inventory](inventory.md)

## Workflow and entities
Book -> load/document -> dispatch -> track -> clear -> receive -> cost.
Owned entities: Shipment, booking, container, goods allocation, event, customs evidence, freight cost. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Tracking is sourced observation; approved API/feed/permitted acquisition adapters only.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| LOG-001 | Containers | Record number/type/seal/owner/status | Identifier validation applied |
| LOG-002 | Goods linkage | Allocate weights/items/lots/orders | Cannot exceed source eligibility |
| LOG-003 | Bookings | Record route/vessel/voyage/cutoffs | Amendment evidence retained |
| LOG-004 | Milestones | Separate planned/estimated/actual | Stale event cannot overwrite verified newer data |
| LOG-005 | Maps | Show coordinates/time/source | Unknown location not fabricated |
| LOG-006 | Acquisition | Import approved feed/document evidence | Uncertain extraction enters review |
| LOG-007 | Trade documents | Version packing list/invoice/BL/origin | Issued version reproducible |
| LOG-008 | Incoterms | Store agreed terms/responsibilities | Cost/transfer policy matches contract |
| LOG-009 | Classification | Use approved HS/jurisdiction rules | Stale/unsupported code needs review |
| LOG-010 | Clearance | Track broker holds/submissions/evidence | No clearance without evidence |
| LOG-011 | Freight allocation | Allocate duty/insurance/transport | Total reconciles approved costs |
| LOG-012 | Demurrage | Track free-time/charges/disputes | Estimates and bills separate |
| LOG-013 | Port handoff | Record unloading/receipt variance | Transit ends only on valid receipt |
| LOG-014 | Carrier choice | Compare price/capacity/service basis | Recommendation not auto-contract |
| LOG-015 | Routes | Suggest feasible approved stops | Unserviceable stop flagged |
| LOG-016 | Delivery proof | Record permitted signature/photo | Retry not double-fulfillment |
| LOG-017 | Claims | Track loss/insurance recovery | Claim not erasure of stock loss |
| LOG-018 | LC linkage | Tie trade finance/document milestones | Funding hold visible |
| LOG-019 | ETA alerts | Show confidence/staleness | Alert not automatic fee posting |
| LOG-020 | Transport metrics | Define lead time/freight/reliability | Event source basis preserved |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: Stale event; duplicate feed; split BL; late freight.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

