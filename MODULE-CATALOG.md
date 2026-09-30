# Module catalog

33 modules; 699 numbered module requirements. All begin as planned. Core documents add universal platform, financial, UX and operational controls.

| Module | ID prefix | Hard prerequisites | Requirements |
| --- | --- | --- | --- |
| [Administration, demos and deployment console](modules/admin-demo.md) | ADM | platform | 22 |
| [Payables, expense and payments](modules/ap-expenses.md) | AP | platform, finance-gl, tax-compliance | 22 |
| [Receivables, invoicing and collections](modules/ar-billing.md) | AR | platform, finance-gl, tax-compliance | 22 |
| [Fixed assets, equipment and maintenance](modules/assets-maintenance.md) | AST | platform, finance-gl | 20 |
| [Workflows, AI and integration orchestration](modules/automation-ai.md) | AUT | platform | 24 |
| [CRM, marketing and customer lifecycle](modules/crm.md) | CRM | platform | 18 |
| [Customization, extensions and onboarding](modules/customization-platform.md) | CFG | platform | 20 |
| [Documents, approvals and internal collaboration](modules/documents-collaboration.md) | DOC | platform | 18 |
| [General ledger, accounting and close](modules/finance-gl.md) | GL | platform | 28 |
| [Fleet, rental and resource operations](modules/fleet-rental.md) | FLT | platform, assets-maintenance, sales-orders | 16 |
| [Governance, risk and audit controls](modules/governance-risk.md) | GRC | platform | 20 |
| [Core HR and employee lifecycle](modules/hr-core.md) | HR | platform | 30 |
| [Inventory, valuation and stock control](modules/inventory.md) | INV | platform | 24 |
| [Specialized financing and lending servicing](modules/lending-servicing.md) | LND | platform, finance-gl, tax-compliance, treasury-financing | 16 |
| [Logistics, containers and international trade](modules/logistics-trade.md) | LOG | platform, sales-orders, procurement, inventory | 20 |
| [Manufacturing, BOM, MRP and production](modules/manufacturing.md) | MFG | platform, inventory, procurement, finance-gl | 28 |
| [Payroll, benefits and compensation](modules/payroll-benefits.md) | PAY | platform, hr-core, time-workforce, finance-gl, tax-compliance, treasury-financing | 26 |
| [Budgeting, planning, costing and consolidation](modules/planning-consolidation.md) | EPM | platform, finance-gl | 20 |
| [Platform, organization and identity](modules/platform.md) | PLT | Always-on core | 22 |
| [POS and retail operations](modules/pos-retail.md) | POS | platform, sales-orders, inventory, treasury-financing | 20 |
| [Procurement, sourcing and purchasing](modules/procurement.md) | PUR | platform, ap-expenses | 20 |
| [Projects, jobs, BOQ and construction](modules/projects-boq.md) | PRJ | platform, finance-gl, sales-orders, procurement | 25 |
| [Quality and product lifecycle](modules/quality-plm.md) | QLT | platform, inventory | 18 |
| [Recruitment, performance and learning](modules/recruitment-talent.md) | TAL | platform, hr-core | 20 |
| [Dashboards and reporting](modules/reporting-analytics.md) | BI | platform | 20 |
| [Sales, pricing, CPQ and fulfillment](modules/sales-orders.md) | SAL | platform, ar-billing | 20 |
| [Service, support and field operations](modules/service-management.md) | SRV | platform, sales-orders | 20 |
| [Subscriptions, commerce and revenue contracts](modules/subscription-commerce.md) | COM | platform, sales-orders, ar-billing | 20 |
| [Supplier lifecycle and contract portal](modules/supplier-management.md) | SUP | platform | 18 |
| [Tax and statutory interfaces](modules/tax-compliance.md) | TAX | platform, finance-gl | 20 |
| [Time, attendance, leave and scheduling](modules/time-workforce.md) | TIM | platform, hr-core | 20 |
| [Banking, treasury, financing and partner distributions](modules/treasury-financing.md) | TRY | platform, finance-gl | 22 |
| [Warehouse execution and scanning](modules/warehouse.md) | WMS | platform, inventory | 20 |

## Conditional and optional dependencies

- Financially valued inventory requires finance-gl plus approved account/valuation policies; quantity-only mode cannot claim financial valuation.
- Warehouse/manufacturing/retail workflows require their named operational dependencies. Service-only sales need no fabricated inventory movement.
- Country capability dependencies are validated at feature level, not satisfied by a generic country switch.
- Reporting/automation/customization use the enabled domain datasets/commands as optional adapters; each published artifact validates those references.
- Control console admin-demo has a separate deployment boundary, even though it reuses platform contracts.
- Lending, regulated quality and specialized industry packs require additional local/expert qualification.

## Availability and toggles

Use MODULE-CONTRACT.md for dependency-aware enable/drain/read-only/disable; capability readiness and user permission are independent. Planned features are not production-enabled. In-flight obligations and historical legal access persist after menu removal.

## Common coverage

Every row inherits validation, authorization, scoped data, state/concurrency, audit, APIs/events, finance where applicable, reports, migration, operations, accessible UI and failure tests from MODULE-CONTRACT.md. Do not treat the short minimum acceptance cell as the complete implementation definition.
