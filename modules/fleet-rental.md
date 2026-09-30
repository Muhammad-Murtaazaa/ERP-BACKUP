# Fleet, rental and resource operations

**Module ID:** fleet-rental  
**Prefix:** FLT  
**Readiness:** planned; scope-specific verification required  
**Hard dependencies:** [platform](platform.md), [assets-maintenance](assets-maintenance.md), [sales-orders](sales-orders.md)

## Workflow and entities
Reserve -> contract/deposit -> handover -> use/service -> return -> settle.
Owned entities: Vehicle/resource, booking, rental contract, handover, meter, damage, return, settlement. Separate operators, process owners, approvers, administrators and auditors; portal users access only their authorized party records.

## Controls
Rental availability, custody and financial ownership distinct; deposits separately accounted.
All rows inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [SECURITY.md](../SECURITY.md), [logic.md](../logic.md) and relevant financial/localization rules.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| FLT-001 | Resource catalog | Define rentable assets/classes/availability | Out-of-service resource unavailable |
| FLT-002 | Reservations | Bound dated capacity | Concurrent booking cannot exceed fleet |
| FLT-003 | Rental pricing | Version duration/mileage/usage rules | Agreed price snapshot retained |
| FLT-004 | Contracts | Approve parties/terms/evidence | Signed revision immutable |
| FLT-005 | Deposits | Link AR advance/refund policy | Deposit not earned revenue |
| FLT-006 | Handover | Record condition/meter/accessories | Required evidence gates dispatch |
| FLT-007 | Returns | Record time/condition/remaining assets | Duplicate return not settle twice |
| FLT-008 | Usage charges | Apply reviewed meter/duration/overage | Meter anomaly requires review |
| FLT-009 | Damage claims | Collect evidence/approval/dispute | Unproven estimate not automatic charge |
| FLT-010 | Maintenance blocks | Respect service/safety holds | Scheduler cannot allocate blocked vehicle |
| FLT-011 | Fuel/expenses | Record eligible usage/cost/source | Duplicate source not duplicate expense |
| FLT-012 | Driver assignments | Validate permission/license/eligibility | Expired credentials blocked by policy |
| FLT-013 | Telematics | Use approved transparent tracking | Missing telemetry not fabricated |
| FLT-014 | Extensions | Amend dates/rates and check conflicts | No silent overlap with next booking |
| FLT-015 | Billing | Generate eligible rental/usage charges | Same entitlement not rebilled |
| FLT-016 | Fleet metrics | Define utilization/revenue/downtime | Idle/maintenance basis visible |

## UI, reports and automation
Use scoped task workspace/list/detail/editor, accessible approval or execution panel, timeline, settings, authorized imports/exports and contextual help. [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) define shared behavior. [REPORTING.md](../REPORTING.md) governs metric definitions, date/currency basis and drill-through. Events use committed outbox facts; actions run scoped identities and durable intents under [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Optional adapters have explicit qualification and failure handling.

## Tests and lifecycle
Domain cases: Double booking; late return; damage dispute; meter rollback.
Also verify field/scope denial, duplicate event/command, stale revision, unavailable dependency, worker crash, conflicting effective date and retention. Schema/API detail is expanded during the chosen slice. Enable requires compatible dependencies/configuration/coverage. Disable drains outstanding work while retaining legal history and authorized correction/settlement. Specialized regulated capabilities remain unavailable until their separate gate passes.

