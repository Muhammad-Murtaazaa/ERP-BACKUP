# Requirements traceability register

This register covers 699 module feature IDs. Planned means specified only; implementation/build, test run, country scope and reviewer evidence must be added when work occurs. None is marked passed.

## Engineering trace fields

For each ID record owning role/person, release slice, entity/command/event changes, UI reference, implementation/build, unit/integration/E2E/security/accessibility evidence, country/industry scope, reviewer and readiness. Domain behavior/minimum acceptance live in linked module files; universal checks live in MODULE-CONTRACT.md.

## Product-to-specification mapping

| Product outcome | Primary specifications |
| --- | --- |
| Reusable platform and client operation | architecture.md, MODULE-CONTRACT.md, OWNERSHIP-AND-HANDOVER.md |
| Financial integrity and four-level COA | FINANCIAL-CONTROLS.md, COA.md, DATABASE-TRANSACTIONS.md |
| Attractive accessible task UX | design-system.md, UX-SCREEN-SPECS.md |
| Admin, demos, domain/module toggles | ADMIN-CONSOLE.md, modules/admin-demo.md |
| Automation and AI efficiency | AUTOMATION-AND-AI.md, modules/automation-ai.md |
| Pakistan and US scope | LOCALIZATION.md, modules/tax-compliance.md, modules/payroll-benefits.md |
| Schema, API and security | DATA-MODEL.md, DATA-DICTIONARY.md, API-AND-EVENTS.md, SECURITY.md |
| Onboarding, customization and migration | CUSTOMIZATION.md, ONBOARDING-AND-MIGRATION.md |
| Enterprise verification and operations | TEST-STRATEGY.md, DEPLOYMENT-AND-OPERATIONS.md |

## Module requirement register

| ID | Module / feature | Initial status | Evidence |
| --- | --- | --- | --- |
| ADM-001 | [ADM — Client registry](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-002 | [ADM — Templates](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-003 | [ADM — Assembly](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-004 | [ADM — Provisioning](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-005 | [ADM — Synthetic seed](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-006 | [ADM — Persona users](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-007 | [ADM — Subdomains](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-008 | [ADM — Custom domains](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-009 | [ADM — TLS](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-010 | [ADM — Routing](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-011 | [ADM — Module enable](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-012 | [ADM — Module disable](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-013 | [ADM — Reset](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-014 | [ADM — Expiry](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-015 | [ADM — Cloning](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-016 | [ADM — Quotas](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-017 | [ADM — Releases](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-018 | [ADM — Fleet health](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-019 | [ADM — Support](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-020 | [ADM — Audit/cost](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-021 | [ADM — Portability](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| ADM-022 | [ADM — Domain retirement](modules/admin-demo.md) | Planned | Not yet implemented/tested |
| AP-001 | [AP — Invoice capture](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-002 | [AP — Duplicate detection](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-003 | [AP — Two-way match](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-004 | [AP — Three-way match](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-005 | [AP — Service acceptance](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-006 | [AP — Non-PO exception](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-007 | [AP — Supplier credits](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-008 | [AP — Expense claims](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-009 | [AP — Travel advances](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-010 | [AP — Corporate cards](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-011 | [AP — Recurring bills](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-012 | [AP — Payment proposals](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-013 | [AP — Payment release](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-014 | [AP — Batch payment](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-015 | [AP — Supplier deposits](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-016 | [AP — Withholding](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-017 | [AP — AP aging](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-018 | [AP — Early discounts](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-019 | [AP — Supplier statements](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-020 | [AP — Payment holds](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-021 | [AP — Refund recovery](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AP-022 | [AP — AP reconciliation](modules/ap-expenses.md) | Planned | Not yet implemented/tested |
| AR-001 | [AR — Invoice entry](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-002 | [AR — Partial billing](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-003 | [AR — Terms/installments](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-004 | [AR — Recurring billing](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-005 | [AR — Debit notes](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-006 | [AR — Credit notes](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-007 | [AR — Advances](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-008 | [AR — Receipts](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-009 | [AR — Allocations](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-010 | [AR — Dunning](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-011 | [AR — Statements](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-012 | [AR — Aging](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-013 | [AR — Credit exposure](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-014 | [AR — Disputes](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-015 | [AR — Write-offs](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-016 | [AR — Refunds](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-017 | [AR — Withholding evidence](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-018 | [AR — Deferred revenue](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-019 | [AR — Document issue](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-020 | [AR — Late charges](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-021 | [AR — Receipt reversals](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AR-022 | [AR — AR reconciliation](modules/ar-billing.md) | Planned | Not yet implemented/tested |
| AST-001 | [AST — Asset registry](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-002 | [AST — Capitalization](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-003 | [AST — CIP](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-004 | [AST — Depreciation books](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-005 | [AST — Depreciation run](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-006 | [AST — Transfers](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-007 | [AST — Revaluation/impairment](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-008 | [AST — Disposal](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-009 | [AST — Verification](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-010 | [AST — Lease asset gate](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-011 | [AST — Equipment](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-012 | [AST — Maintenance plans](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-013 | [AST — Corrective work](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-014 | [AST — Maintenance scheduling](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-015 | [AST — Permits](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-016 | [AST — Meters](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-017 | [AST — Spares](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-018 | [AST — Maintenance costing](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-019 | [AST — Reliability](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AST-020 | [AST — Asset reconciliation](modules/assets-maintenance.md) | Planned | Not yet implemented/tested |
| AUT-001 | [AUT — Builder](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-002 | [AUT — Versioning](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-003 | [AUT — Event triggers](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-004 | [AUT — Schedules](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-005 | [AUT — Approval steps](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-006 | [AUT — Simulation](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-007 | [AUT — Durability](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-008 | [AUT — Action authority](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-009 | [AUT — Retries](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-010 | [AUT — Unknown outcome](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-011 | [AUT — Compensation](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-012 | [AUT — OCR](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-013 | [AUT — Assistant](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-014 | [AUT — Tool allowlists](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-015 | [AUT — Prompt defense](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-016 | [AUT — Autonomy tiers](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-017 | [AUT — Predictions](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-018 | [AUT — Anomalies](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-019 | [AUT — Model governance](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-020 | [AUT — Connector health](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-021 | [AUT — Budgets](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-022 | [AUT — Savings](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-023 | [AUT — Retention](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| AUT-024 | [AUT — Pause switch](modules/automation-ai.md) | Planned | Not yet implemented/tested |
| CRM-001 | [CRM — Lead capture](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-002 | [CRM — Deduplication](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-003 | [CRM — Accounts/contacts](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-004 | [CRM — Qualification](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-005 | [CRM — Pipeline](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-006 | [CRM — Activities](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-007 | [CRM — Communications](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-008 | [CRM — Campaigns](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-009 | [CRM — Consent](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-010 | [CRM — Lead routing](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-011 | [CRM — Quote handoff](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-012 | [CRM — Forecast](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-013 | [CRM — Territories](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-014 | [CRM — Account health](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-015 | [CRM — Renewals](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-016 | [CRM — AI summaries](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-017 | [CRM — Attribution](modules/crm.md) | Planned | Not yet implemented/tested |
| CRM-018 | [CRM — Success plans](modules/crm.md) | Planned | Not yet implemented/tested |
| CFG-001 | [CFG — Configuration layers](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-002 | [CFG — Custom fields](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-003 | [CFG — Custom objects](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-004 | [CFG — Form layouts](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-005 | [CFG — Terminology](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-006 | [CFG — Branding](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-007 | [CFG — Templates](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-008 | [CFG — Navigation](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-009 | [CFG — Dashboards](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-010 | [CFG — Rules](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-011 | [CFG — Publish](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-012 | [CFG — Rollback](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-013 | [CFG — Extension SDK](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-014 | [CFG — Compatibility](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-015 | [CFG — Config export](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-016 | [CFG — Setup wizard](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-017 | [CFG — Import staging](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-018 | [CFG — Opening migration](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-019 | [CFG — Contextual help](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| CFG-020 | [CFG — Upgrade preview](modules/customization-platform.md) | Planned | Not yet implemented/tested |
| DOC-001 | [DOC — Attachments](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-002 | [DOC — Versioned documents](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-003 | [DOC — Folders/tags](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-004 | [DOC — Comments](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-005 | [DOC — Mentions](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-006 | [DOC — Tasks](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-007 | [DOC — Review routing](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-008 | [DOC — Signatures](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-009 | [DOC — Templates](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-010 | [DOC — Generated PDFs](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-011 | [DOC — Search](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-012 | [DOC — Sharing](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-013 | [DOC — Access logs](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-014 | [DOC — Retention](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-015 | [DOC — Archiving](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-016 | [DOC — Notifications](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-017 | [DOC — Print queues](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| DOC-018 | [DOC — Export package](modules/documents-collaboration.md) | Planned | Not yet implemented/tested |
| GL-001 | [GL — Four-level COA](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-002 | [GL — Account lifecycle](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-003 | [GL — Mapping studio](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-004 | [GL — Manual journals](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-005 | [GL — Recurring journals](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-006 | [GL — Accrual reversals](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-007 | [GL — Journal approval](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-008 | [GL — Parallel books](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-009 | [GL — Period control](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-010 | [GL — Period guard](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-011 | [GL — Dimensions](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-012 | [GL — Allocations](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-013 | [GL — Intercompany](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-014 | [GL — FX revaluation](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-015 | [GL — Accruals](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-016 | [GL — Prepayments](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-017 | [GL — Suspense](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-018 | [GL — Opening balances](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-019 | [GL — Trial balance](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-020 | [GL — Statements](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-021 | [GL — Account ledger](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-022 | [GL — Close workspace](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-023 | [GL — Reopen](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-024 | [GL — Correction](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-025 | [GL — Budget checks](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-026 | [GL — Audit export](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-027 | [GL — Rebuild balances](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| GL-028 | [GL — Policy versioning](modules/finance-gl.md) | Planned | Not yet implemented/tested |
| FLT-001 | [FLT — Resource catalog](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-002 | [FLT — Reservations](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-003 | [FLT — Rental pricing](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-004 | [FLT — Contracts](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-005 | [FLT — Deposits](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-006 | [FLT — Handover](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-007 | [FLT — Returns](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-008 | [FLT — Usage charges](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-009 | [FLT — Damage claims](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-010 | [FLT — Maintenance blocks](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-011 | [FLT — Fuel/expenses](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-012 | [FLT — Driver assignments](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-013 | [FLT — Telematics](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-014 | [FLT — Extensions](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-015 | [FLT — Billing](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| FLT-016 | [FLT — Fleet metrics](modules/fleet-rental.md) | Planned | Not yet implemented/tested |
| GRC-001 | [GRC — Controls](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-002 | [GRC — Risk register](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-003 | [GRC — Segregation review](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-004 | [GRC — Access certification](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-005 | [GRC — Audit evidence](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-006 | [GRC — Change review](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-007 | [GRC — Policies](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-008 | [GRC — Incidents](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-009 | [GRC — Findings](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-010 | [GRC — Holds](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-011 | [GRC — Classification](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-012 | [GRC — Privacy cases](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-013 | [GRC — Monitoring](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-014 | [GRC — Financial controls](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-015 | [GRC — Third-party risk](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-016 | [GRC — Continuity](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-017 | [GRC — Fraud signals](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-018 | [GRC — Readiness](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-019 | [GRC — Waivers](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| GRC-020 | [GRC — Audit export](modules/governance-risk.md) | Planned | Not yet implemented/tested |
| HR-001 | [HR — Employee profile](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-002 | [HR — Employment history](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-003 | [HR — Positions](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-004 | [HR — Org chart](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-005 | [HR — Job catalog](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-006 | [HR — Contracts](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-007 | [HR — Probation](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-008 | [HR — Onboarding](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-009 | [HR — Provisioning](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-010 | [HR — Asset custody](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-011 | [HR — Employee self-service](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-012 | [HR — Manager self-service](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-013 | [HR — Compensation history](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-014 | [HR — Transfers/promotions](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-015 | [HR — Multiple assignments](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-016 | [HR — Documents](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-017 | [HR — Letters](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-018 | [HR — Employee relations](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-019 | [HR — Safety incidents](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-020 | [HR — Accommodations](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-021 | [HR — Acknowledgments](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-022 | [HR — Employee loans](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-023 | [HR — Exit](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-024 | [HR — Final settlement](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-025 | [HR — Revocation](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-026 | [HR — Rehire](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-027 | [HR — HR metrics](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-028 | [HR — Retention](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-029 | [HR — Mobility](modules/hr-core.md) | Planned | Not yet implemented/tested |
| HR-030 | [HR — Employee feedback](modules/hr-core.md) | Planned | Not yet implemented/tested |
| INV-001 | [INV — Item policies](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-002 | [INV — Variants/barcodes](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-003 | [INV — UOM](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-004 | [INV — Locations](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-005 | [INV — Lots](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-006 | [INV — Serials](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-007 | [INV — Quantity ledger](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-008 | [INV — Reservations](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-009 | [INV — Quarantine](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-010 | [INV — Negative stock](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-011 | [INV — FIFO](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-012 | [INV — Weighted average](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-013 | [INV — Standard cost](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-014 | [INV — Specific identification](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-015 | [INV — Landed cost](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-016 | [INV — Transit](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-017 | [INV — Consignment](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-018 | [INV — Counts](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-019 | [INV — Adjustments](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-020 | [INV — Reorder](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-021 | [INV — Recall](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-022 | [INV — Reconciliation](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-023 | [INV — Aging](modules/inventory.md) | Planned | Not yet implemented/tested |
| INV-024 | [INV — Opening stock](modules/inventory.md) | Planned | Not yet implemented/tested |
| LND-001 | [LND — Product policy](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-002 | [LND — Applications](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-003 | [LND — Identity checks](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-004 | [LND — Credit assessment](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-005 | [LND — Agreements](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-006 | [LND — Schedules](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-007 | [LND — Disbursement](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-008 | [LND — Collections](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-009 | [LND — Prepayment](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-010 | [LND — Delinquency](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-011 | [LND — Restructuring](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-012 | [LND — Impairment](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-013 | [LND — Collateral](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-014 | [LND — Statements](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-015 | [LND — Regulatory data](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LND-016 | [LND — Closure](modules/lending-servicing.md) | Planned | Not yet implemented/tested |
| LOG-001 | [LOG — Containers](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-002 | [LOG — Goods linkage](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-003 | [LOG — Bookings](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-004 | [LOG — Milestones](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-005 | [LOG — Maps](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-006 | [LOG — Acquisition](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-007 | [LOG — Trade documents](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-008 | [LOG — Incoterms](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-009 | [LOG — Classification](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-010 | [LOG — Clearance](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-011 | [LOG — Freight allocation](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-012 | [LOG — Demurrage](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-013 | [LOG — Port handoff](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-014 | [LOG — Carrier choice](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-015 | [LOG — Routes](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-016 | [LOG — Delivery proof](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-017 | [LOG — Claims](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-018 | [LOG — LC linkage](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-019 | [LOG — ETA alerts](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| LOG-020 | [LOG — Transport metrics](modules/logistics-trade.md) | Planned | Not yet implemented/tested |
| MFG-001 | [MFG — Multi-level BOM](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-002 | [MFG — Alternatives](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-003 | [MFG — Engineering change](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-004 | [MFG — Routings](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-005 | [MFG — Work centers](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-006 | [MFG — Production modes](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-007 | [MFG — Demand](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-008 | [MFG — Master plan](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-009 | [MFG — MRP](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-010 | [MFG — Purchase proposals](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-011 | [MFG — Production proposals](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-012 | [MFG — Capacity load](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-013 | [MFG — Finite schedule](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-014 | [MFG — Work orders](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-015 | [MFG — Material issue](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-016 | [MFG — Backflush](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-017 | [MFG — Substitution](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-018 | [MFG — Shop floor](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-019 | [MFG — Partial output](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-020 | [MFG — Scrap/rework](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-021 | [MFG — Co/by-products](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-022 | [MFG — Subcontract work](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-023 | [MFG — Quality gates](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-024 | [MFG — WIP](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-025 | [MFG — Cost variance](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-026 | [MFG — OEE/yield](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-027 | [MFG — Order close](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| MFG-028 | [MFG — Genealogy](modules/manufacturing.md) | Planned | Not yet implemented/tested |
| PAY-001 | [PAY — Calendars](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-002 | [PAY — Components](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-003 | [PAY — Salary/hourly](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-004 | [PAY — Variable pay](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-005 | [PAY — Benefit enrollment](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-006 | [PAY — Employer cost](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-007 | [PAY — Statutory rules](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-008 | [PAY — Overtime/leave](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-009 | [PAY — Deductions](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-010 | [PAY — Loan recovery](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-011 | [PAY — Retro pay](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-012 | [PAY — Off-cycle](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-013 | [PAY — Review](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-014 | [PAY — Approval](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-015 | [PAY — GL allocation](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-016 | [PAY — Posting](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-017 | [PAY — Disbursement](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-018 | [PAY — Payslips](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-019 | [PAY — Remittances](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-020 | [PAY — US reporting](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-021 | [PAY — Pakistan reporting](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-022 | [PAY — Final settlement](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-023 | [PAY — Reconciliation](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-024 | [PAY — Provider files](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-025 | [PAY — Simulation](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| PAY-026 | [PAY — Privacy](modules/payroll-benefits.md) | Planned | Not yet implemented/tested |
| EPM-001 | [EPM — Budget versions](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-002 | [EPM — Plan dimensions](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-003 | [EPM — Drivers](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-004 | [EPM — Rolling forecast](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-005 | [EPM — Commitments](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-006 | [EPM — Variance](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-007 | [EPM — Cash planning](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-008 | [EPM — Workforce planning](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-009 | [EPM — Capital planning](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-010 | [EPM — Cost allocations](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-011 | [EPM — Profitability](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-012 | [EPM — Completion forecast](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-013 | [EPM — Consolidation group](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-014 | [EPM — Translation](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-015 | [EPM — Intercompany match](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-016 | [EPM — Eliminations](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-017 | [EPM — Top-side journals](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-018 | [EPM — Minority interest](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-019 | [EPM — Group reporting](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| EPM-020 | [EPM — Scenario comparisons](modules/planning-consolidation.md) | Planned | Not yet implemented/tested |
| PLT-001 | [PLT — Organizations](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-002 | [PLT — Entity settings](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-003 | [PLT — Shared parties](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-004 | [PLT — Invitations](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-005 | [PLT — SSO](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-006 | [PLT — MFA/recovery](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-007 | [PLT — Scoped roles](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-008 | [PLT — Field security](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-009 | [PLT — Segregation](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-010 | [PLT — Delegation](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-011 | [PLT — Service identities](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-012 | [PLT — Sessions](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-013 | [PLT — Calendars](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-014 | [PLT — Numbering](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-015 | [PLT — Reference data](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-016 | [PLT — Notifications](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-017 | [PLT — Search](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-018 | [PLT — Task inbox](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-019 | [PLT — Audit explorer](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-020 | [PLT — Files](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-021 | [PLT — Localization](modules/platform.md) | Planned | Not yet implemented/tested |
| PLT-022 | [PLT — Quotas](modules/platform.md) | Planned | Not yet implemented/tested |
| POS-001 | [POS — Registers](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-002 | [POS — Shift open](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-003 | [POS — Scan/cart](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-004 | [POS — Promotions](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-005 | [POS — Split tender](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-006 | [POS — Payment devices](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-007 | [POS — Parked carts](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-008 | [POS — Refunds](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-009 | [POS — Drawer movements](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-010 | [POS — Shift close](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-011 | [POS — Offline capture](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-012 | [POS — Replay](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-013 | [POS — Receipts](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-014 | [POS — Loyalty](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-015 | [POS — Gift credit](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-016 | [POS — Weighted/serial goods](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-017 | [POS — Supervisor limits](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-018 | [POS — Fiscal readiness](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-019 | [POS — Replenishment](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| POS-020 | [POS — Retail reports](modules/pos-retail.md) | Planned | Not yet implemented/tested |
| PUR-001 | [PUR — Requisitions](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-002 | [PUR — Approvals](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-003 | [PUR — Catalog buying](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-004 | [PUR — RFQs](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-005 | [PUR — Bid comparison](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-006 | [PUR — Awards](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-007 | [PUR — PO issue](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-008 | [PUR — Blanket contracts](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-009 | [PUR — Amendments](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-010 | [PUR — Partial receipt](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-011 | [PUR — Service acceptance](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-012 | [PUR — Supplier return](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-013 | [PUR — Budget reservations](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-014 | [PUR — Expediting](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-015 | [PUR — Landed costs](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-016 | [PUR — Subcontracting](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-017 | [PUR — Purchase analytics](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-018 | [PUR — Reorder proposals](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-019 | [PUR — Emergency purchase](modules/procurement.md) | Planned | Not yet implemented/tested |
| PUR-020 | [PUR — Document chain](modules/procurement.md) | Planned | Not yet implemented/tested |
| PRJ-001 | [PRJ — Projects](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-002 | [PRJ — WBS](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-003 | [PRJ — Estimates](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-004 | [PRJ — BOQ](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-005 | [PRJ — Rate analysis](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-006 | [PRJ — Baseline budget](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-007 | [PRJ — Schedules](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-008 | [PRJ — Resource plan](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-009 | [PRJ — Commitments](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-010 | [PRJ — Site time/material](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-011 | [PRJ — Subcontract measurement](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-012 | [PRJ — Physical progress](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-013 | [PRJ — Progress certificates](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-014 | [PRJ — Variations](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-015 | [PRJ — Advance recovery](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-016 | [PRJ — Retention](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-017 | [PRJ — Billing](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-018 | [PRJ — Revenue treatment](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-019 | [PRJ — Completion forecast](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-020 | [PRJ — Site documents](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-021 | [PRJ — Risk/issues](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-022 | [PRJ — Claims](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-023 | [PRJ — Project dashboards](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-024 | [PRJ — Final account](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| PRJ-025 | [PRJ — Defects/warranty](modules/projects-boq.md) | Planned | Not yet implemented/tested |
| QLT-001 | [QLT — Specifications](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-002 | [QLT — Plans](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-003 | [QLT — Receiving quality](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-004 | [QLT — In-process quality](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-005 | [QLT — Final release](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-006 | [QLT — Nonconformance](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-007 | [QLT — Disposition](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-008 | [QLT — Corrective actions](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-009 | [QLT — Supplier quality](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-010 | [QLT — Calibration](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-011 | [QLT — Engineering requests](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-012 | [QLT — Change approval](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-013 | [QLT — Product documents](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-014 | [QLT — Genealogy](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-015 | [QLT — Recall](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-016 | [QLT — Certificates](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-017 | [QLT — Quality analytics](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| QLT-018 | [QLT — Regulated gate](modules/quality-plm.md) | Planned | Not yet implemented/tested |
| TAL-001 | [TAL — Hiring requests](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-002 | [TAL — Career portal](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-003 | [TAL — Applicant tracking](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-004 | [TAL — Candidate dedupe](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-005 | [TAL — Interviews](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-006 | [TAL — Scorecards](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-007 | [TAL — Offers](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-008 | [TAL — Checks](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-009 | [TAL — Hire conversion](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-010 | [TAL — Goals](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-011 | [TAL — Review cycles](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-012 | [TAL — 360 feedback](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-013 | [TAL — Calibration](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-014 | [TAL — Development](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-015 | [TAL — Learning catalog](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-016 | [TAL — Assessments](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-017 | [TAL — Certifications](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-018 | [TAL — Succession](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-019 | [TAL — Merit reviews](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| TAL-020 | [TAL — Talent analysis](modules/recruitment-talent.md) | Planned | Not yet implemented/tested |
| BI-001 | [BI — Datasets](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-002 | [BI — Metrics](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-003 | [BI — Dashboard builder](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-004 | [BI — Role templates](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-005 | [BI — Report builder](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-006 | [BI — Financial packs](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-007 | [BI — Operational reports](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-008 | [BI — As-of](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-009 | [BI — Currencies](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-010 | [BI — Drill-through](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-011 | [BI — Saved views](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-012 | [BI — Scheduled delivery](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-013 | [BI — Exports](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-014 | [BI — Pivots](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-015 | [BI — Forecast charts](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-016 | [BI — Accessibility](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-017 | [BI — Quality flags](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-018 | [BI — Query policy](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-019 | [BI — Versioned output](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| BI-020 | [BI — Scaling](modules/reporting-analytics.md) | Planned | Not yet implemented/tested |
| SAL-001 | [SAL — Price lists](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-002 | [SAL — Discounts](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-003 | [SAL — CPQ](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-004 | [SAL — Quote versions](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-005 | [SAL — Margin approval](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-006 | [SAL — Orders](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-007 | [SAL — Credit release](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-008 | [SAL — Promise dates](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-009 | [SAL — Reservations](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-010 | [SAL — Partial fulfillment](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-011 | [SAL — Backorders](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-012 | [SAL — Drop shipment](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-013 | [SAL — Amendments](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-014 | [SAL — Returns](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-015 | [SAL — Freight](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-016 | [SAL — Commissions](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-017 | [SAL — Blanket sales](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-018 | [SAL — Sales analysis](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-019 | [SAL — Portal](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SAL-020 | [SAL — Signature adapter](modules/sales-orders.md) | Planned | Not yet implemented/tested |
| SRV-001 | [SRV — Case intake](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-002 | [SRV — Triage](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-003 | [SRV — SLAs](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-004 | [SRV — Entitlements](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-005 | [SRV — Dispatch](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-006 | [SRV — Appointments](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-007 | [SRV — Work orders](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-008 | [SRV — Parts](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-009 | [SRV — Time](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-010 | [SRV — Extra work](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-011 | [SRV — Acceptance](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-012 | [SRV — Warranty](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-013 | [SRV — Preventive service](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-014 | [SRV — Knowledge base](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-015 | [SRV — Portal](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-016 | [SRV — Escalation](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-017 | [SRV — Service billing](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-018 | [SRV — Offline drafts](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-019 | [SRV — Service metrics](modules/service-management.md) | Planned | Not yet implemented/tested |
| SRV-020 | [SRV — Closure](modules/service-management.md) | Planned | Not yet implemented/tested |
| COM-001 | [COM — Channel catalog](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-002 | [COM — Order connectors](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-003 | [COM — Checkout](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-004 | [COM — Plans](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-005 | [COM — Lifecycle](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-006 | [COM — Usage](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-007 | [COM — Tiers](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-008 | [COM — Proration](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-009 | [COM — Recurring billing](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-010 | [COM — Trials](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-011 | [COM — Collections](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-012 | [COM — Dunning](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-013 | [COM — Revenue obligations](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-014 | [COM — Recognition](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-015 | [COM — Chargebacks](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-016 | [COM — Channel availability](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-017 | [COM — Self-service](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-018 | [COM — Commerce metrics](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-019 | [COM — Renewal forecast](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| COM-020 | [COM — Local gate](modules/subscription-commerce.md) | Planned | Not yet implemented/tested |
| SUP-001 | [SUP — Supplier directory](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-002 | [SUP — Onboarding](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-003 | [SUP — Qualification](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-004 | [SUP — Tax registration](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-005 | [SUP — Bank verification](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-006 | [SUP — Risk assessments](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-007 | [SUP — Certificates](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-008 | [SUP — Contracts](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-009 | [SUP — Prices](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-010 | [SUP — Scorecards](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-011 | [SUP — Segmentation](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-012 | [SUP — Portal orders](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-013 | [SUP — Portal invoices](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-014 | [SUP — Collaboration](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-015 | [SUP — Suspension](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-016 | [SUP — Master merge](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-017 | [SUP — Renewal reminders](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| SUP-018 | [SUP — Concentration](modules/supplier-management.md) | Planned | Not yet implemented/tested |
| TAX-001 | [TAX — Jurisdiction](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-002 | [TAX — Tax classes](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-003 | [TAX — Effective rules](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-004 | [TAX — Inclusive tax](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-005 | [TAX — Compound taxes](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-006 | [TAX — Exemptions](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-007 | [TAX — Withholding](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-008 | [TAX — Recoverability](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-009 | [TAX — Return datasets](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-010 | [TAX — Submission states](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-011 | [TAX — Corrections](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-012 | [TAX — Pakistan invoicing](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-013 | [TAX — US sales tax](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-014 | [TAX — Payroll tax](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-015 | [TAX — Submission evidence](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-016 | [TAX — Customs policy](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-017 | [TAX — Rule updates](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-018 | [TAX — Tax reconciliation](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-019 | [TAX — Compliance calendar](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TAX-020 | [TAX — Readiness registry](modules/tax-compliance.md) | Planned | Not yet implemented/tested |
| TIM-001 | [TIM — Time clocks](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-002 | [TIM — Device adapters](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-003 | [TIM — Attendance](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-004 | [TIM — Timesheets](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-005 | [TIM — Corrections](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-006 | [TIM — Shift templates](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-007 | [TIM — Rosters](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-008 | [TIM — Swaps](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-009 | [TIM — Overtime](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-010 | [TIM — Leave accrual](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-011 | [TIM — Leave requests](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-012 | [TIM — Leave calendars](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-013 | [TIM — Holidays](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-014 | [TIM — Remote attendance](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-015 | [TIM — Exceptions](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-016 | [TIM — Payroll freeze](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-017 | [TIM — Project allocations](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-018 | [TIM — Staffing forecast](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-019 | [TIM — Mobile actions](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TIM-020 | [TIM — Time metrics](modules/time-workforce.md) | Planned | Not yet implemented/tested |
| TRY-001 | [TRY — Bank registry](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-002 | [TRY — Statement import](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-003 | [TRY — Matching](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-004 | [TRY — Split matching](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-005 | [TRY — Reconciliation close](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-006 | [TRY — Cash position](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-007 | [TRY — Cash forecast](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-008 | [TRY — Liquidity alerts](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-009 | [TRY — Bank transfers](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-010 | [TRY — Facilities](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-011 | [TRY — Drawdowns](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-012 | [TRY — Repayment schedules](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-013 | [TRY — Charge accrual](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-014 | [TRY — Covenants](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-015 | [TRY — Collateral](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-016 | [TRY — Letters of credit](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-017 | [TRY — FX exposure](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-018 | [TRY — Partner agreements](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-019 | [TRY — Distribution proposal](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-020 | [TRY — Distribution settlement](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-021 | [TRY — Lender statements](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| TRY-022 | [TRY — Customer lending gate](modules/treasury-financing.md) | Planned | Not yet implemented/tested |
| WMS-001 | [WMS — Layout](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-002 | [WMS — Mobile receipt](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-003 | [WMS — Putaway](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-004 | [WMS — Waves](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-005 | [WMS — Picking](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-006 | [WMS — Task leases](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-007 | [WMS — Short picks](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-008 | [WMS — Packing](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-009 | [WMS — Labels](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-010 | [WMS — Replenishment](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-011 | [WMS — Cross-dock](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-012 | [WMS — Transfers](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-013 | [WMS — Blind counts](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-014 | [WMS — Offline scanning](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-015 | [WMS — Damage](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-016 | [WMS — Dock schedule](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-017 | [WMS — Handling units](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-018 | [WMS — Labor metrics](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-019 | [WMS — Task dashboard](modules/warehouse.md) | Planned | Not yet implemented/tested |
| WMS-020 | [WMS — Dispatch check](modules/warehouse.md) | Planned | Not yet implemented/tested |

## Specification-only verification

VALIDATION.md records document consistency checks. It does not establish ERP feature readiness. Runtime evidence belongs to this register after implementation.
