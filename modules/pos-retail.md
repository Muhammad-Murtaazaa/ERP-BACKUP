# POS and retail operations

**Module ID:** pos-retail  
**Prefix:** POS  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md), [sales-orders](sales-orders.md), [inventory](inventory.md), [treasury-financing](treasury-financing.md)

## Workflow and entities
Open -> sell/tender -> sync/post -> return -> count/reconcile -> close.
Owned entities: Store, register, shift, sale, tender, drawer movement, refund, gift balance, offline intent. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Tender authorization and completed sale distinct; no raw card/PIN storage; offline use bounded.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| POS-001 | Registers | Bind approved store/device/tenders | Unknown device cannot finalize |
| POS-002 | Shift open | Capture float/responsible cashier | Active shift obeys register policy |
| POS-003 | Scan/cart | Lookup barcode/quantity with manual alternative | Unknown scan does not substitute item |
| POS-004 | Promotions | Apply versioned eligibility/stacking | Rule caps enforced |
| POS-005 | Split tender | Track each authorization and total | Sale completes only with valid total |
| POS-006 | Payment devices | Use qualified provider adapters | Raw card data absent from ERP |
| POS-007 | Parked carts | Resume scoped draft/revision | Concurrent edit conflict visible |
| POS-008 | Refunds | Validate source/tender/eligible credit | Cannot over-refund |
| POS-009 | Drawer movements | Record paid-in/out/reason/authority | Expected cash updates once |
| POS-010 | Shift close | Compare expected/count/deposit | Variance needs explicit review |
| POS-011 | Offline capture | Queue approved bounded intents | Server revalidates conflicts |
| POS-012 | Replay | Use device/intent dedupe keys | Repeated sync creates one sale |
| POS-013 | Receipts | Print/email under consent | Printer retry creates no extra sale |
| POS-014 | Loyalty | Accrue/redeem approved points | Concurrent redemption bounded |
| POS-015 | Gift credit | Track liability and redemption | Usable balance cannot overspend |
| POS-016 | Weighted/serial goods | Validate scale/serial evidence | Invalid weight/duplicate serial rejected |
| POS-017 | Supervisor limits | Enforce void/refund/discount authority | UI-only override cannot bypass server |
| POS-018 | Fiscal readiness | Gate local receipt/offline rules | Unsupported fiscal mode unavailable |
| POS-019 | Replenishment | Propose approved transfer/reorder | Proposal does not bypass approval |
| POS-020 | Retail reports | Show sales/tender/returns/shrink | Shift reconciles with bank/ledger |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: Split tender failure; offline replay; settled refund; cash discrepancy.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

