# Inventory, valuation and stock control

**Module ID:** inventory  
**Prefix:** INV  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md)

## Workflow and entities
Define -> receive -> reserve -> transfer/consume -> ship -> count/value.
Owned entities: Item, variant, UOM, location, lot, serial, movement, reservation, value layer, count. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Stock facts immutable; valued mode requires finance-gl; available excludes reservations/quarantine.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| INV-001 | Item policies | Define type/tracking/valuation | Used policy change needs migration |
| INV-002 | Variants/barcodes | Validate unique combinations | Duplicate barcode rejected |
| INV-003 | UOM | Version exact conversions | Invalid/ambiguous conversion rejected |
| INV-004 | Locations | Track entity/warehouse/bin | Cross-scope location fails |
| INV-005 | Lots | Record batch/expiry/source | Expired/held lot not auto-allocated |
| INV-006 | Serials | Track unique status/location | Cannot dispatch same serial twice |
| INV-007 | Quantity ledger | Persist movements/corrections | Rebuild agrees with on-hand |
| INV-008 | Reservations | Allocate/release/expire with locks | Concurrent allocation cannot overreserve |
| INV-009 | Quarantine | Separate held from saleable | Availability excludes held quantity |
| INV-010 | Negative stock | Default deny; gated reviewed exceptions | Uncertain cost explicitly tracked |
| INV-011 | FIFO | Consume approved dated value layers | Layer never overconsumed |
| INV-012 | Weighted average | Apply reviewed dated averaging | Backdated movement follows controlled adjustment |
| INV-013 | Standard cost | Version standards and variance | Actual/standard difference reconciles |
| INV-014 | Specific identification | Link actual serial/lot cost | Cost provenance retained |
| INV-015 | Landed cost | Allocate extra costs by defined driver | Allocation total exact |
| INV-016 | Transit | Track dispatch and pending receipt | Both legs do not double-count |
| INV-017 | Consignment | Separate ownership and consumption | Third-party stock excluded from owned value |
| INV-018 | Counts | Freeze/snapshot/review variance | Unreviewed count cannot adjust |
| INV-019 | Adjustments | Require reason/authority/value preview | Retry posts once |
| INV-020 | Reorder | Propose min/max/safety stock | Demand/lead-time assumptions visible |
| INV-021 | Recall | Trace receipt/production/sale descendants | All affected lots identifiable |
| INV-022 | Reconciliation | Compare value ledger/control GL | Difference exposes date/policy/source |
| INV-023 | Aging | Report slow/expired quantity/value | Scoped totals agree with stock |
| INV-024 | Opening stock | Load approved lots/serials/values | Opening GL/stock reconcile |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: Concurrent reservation; backdated cost; negative stock; duplicate serial.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

