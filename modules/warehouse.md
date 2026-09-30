# Warehouse execution and scanning

**Module ID:** warehouse  
**Prefix:** WMS  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md), [inventory](inventory.md)

## Workflow and entities
Receive -> putaway -> replenish -> pick -> pack -> dispatch -> count.
Owned entities: Zone, bin, task, wave, allocation, pack, handling unit, count assignment. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Execution calls inventory contract; scan retries cannot create stock twice.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| WMS-001 | Layout | Define zones/capacity/restrictions | Invalid item/bin combination blocked |
| WMS-002 | Mobile receipt | Scan item/PO/lot/serial | Duplicate scan idempotent |
| WMS-003 | Putaway | Suggest eligible bins | Capacity/quality restrictions honored |
| WMS-004 | Waves | Group approved eligible demand | Demand cannot join conflicting active waves |
| WMS-005 | Picking | Apply FIFO/FEFO/lot rules | Held/expired units unavailable |
| WMS-006 | Task leases | Assign/recover operator tasks | Same task not executed twice |
| WMS-007 | Short picks | Record actual/reason/remaining | Shortage not marked full fulfillment |
| WMS-008 | Packing | Verify contents and handling units | No duplicate/unpicked serial |
| WMS-009 | Labels | Print versioned barcode labels | Reprint creates no stock |
| WMS-010 | Replenishment | Move reserve to pick faces | Reservations respected |
| WMS-011 | Cross-dock | Allocate eligible inbound to outbound | Quality hold prevents dispatch |
| WMS-012 | Transfers | Record both transit legs | Repeated receipt creates no extra quantity |
| WMS-013 | Blind counts | Assign count/recount thresholds | Prohibited expected quantity hidden |
| WMS-014 | Offline scanning | Queue approved intents | Replay revalidates stock/authority |
| WMS-015 | Damage | Quarantine/dispose under approval | Physical stock not silently reduced |
| WMS-016 | Dock schedule | Reserve capacity/windows | Overlap exposed |
| WMS-017 | Handling units | Trace pallet/carton contents | Containment cycles rejected |
| WMS-018 | Labor metrics | Define throughput/time | Interrupted tasks labeled |
| WMS-019 | Task dashboard | Show blocked/late/ready work | Counts trace current state |
| WMS-020 | Dispatch check | Verify line/carrier evidence | Configured shortage blocks release |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: Two pickers; wrong serial; offline replay; missing transfer leg.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

