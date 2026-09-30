# Product requirements
Version 0.1 • Proposed • Owner: Omnysync product lead

## Problem and proposition
Custom ERP work repeats the same infrastructure and business logic. Demos assembled from disconnected screens misrepresent integration. Clients need usable, configurable business systems that they can own and operate. Build one composable platform with a standard library of domain modules, audited workflows, configurable UX and validated deployment profiles.

## Personas and jobs
| Persona | Primary job | Success evidence |
| --- | --- | --- |
| Omnysync solution architect | Assemble a suitable client solution | Dependency-valid configuration, recorded fit-gap and reproducible build |
| Demo operator | Create a realistic isolated demo quickly | Seeded process flows, safe credentials, expiry and reset |
| Client owner / administrator | Operate their own installation | Complete credentials, restore rehearsal, source/build handover and no central runtime dependency |
| Accountant / controller | Close reconciled books | Traceable vouchers, balanced journals, reconciled subledgers, locked periods |
| Sales / procurement staff | Complete orders without repeat entry | Linked source documents, remaining quantities and exception guidance |
| Warehouse / shop-floor worker | Execute fast, accurate tasks | Scan-first flows, large targets, offline capture where approved |
| HR / payroll specialist | Manage confidential employee lifecycle | Scoped access, effective dates, reproducible pay runs |
| Employee / manager | Self-service and approvals | Clear tasks, mobile access, short learning curve |
| Executive | Make grounded decisions | Governed metrics, freshness, drill-through, scenario assumptions |
| Auditor / support engineer | Explain changes or failures | Read-only evidence; client-authorized, time-limited support access |

## Product boundaries
The reusable core owns identity, organization, localization contracts, workflow execution, configuration, audit, files, command APIs, UI foundations and module lifecycle. Domain modules own their entities and invariants. Industry packs add vocabulary, templates, workflows and specialized entities without bypassing core rules. Country packs contain jurisdiction-specific rules and adapters.

All modules in MODULE-CATALOG.md are intended product scope. Their individual features are initially planned. Vendor feature parity must be demonstrated feature-by-feature; it cannot be inferred from this catalog. Banking APIs, tax filing, customs, payments, biometric systems, e-signatures and payroll providers require contracts and integration qualification.

## Required product capabilities
| ID | Requirement | Acceptance |
| --- | --- | --- |
| PRD-001 | Assemble installations from versioned module manifests | Dependency resolution rejects incompatible builds before provisioning |
| PRD-002 | Separate demo and client production systems | Demo integrations cannot send real money or statutory filings |
| PRD-003 | Independent client operation | Installation passes a disconnected-control-plane operation and restore exercise |
| PRD-004 | Four-level COA and common posting engine | Posting to parents fails; all tested journal sources reconcile |
| PRD-005 | Custom dashboards, reports, account mappings and workflows | Publish requires validation and versioning; historical snapshots remain explainable |
| PRD-006 | Role-aware initial onboarding and contextual help | Pilot users complete the target tasks without instructor intervention |
| PRD-007 | Safe configurable automation | Retry, duplicate delivery, rejection and cancellation cannot double-post or double-pay |
| PRD-008 | Consistent accessible UX across modules | Manual keyboard and screen-reader checks plus automated checks pass critical flows |
| PRD-009 | Web, desktop and mobile clients | All enforce the same server-side commands and permission boundaries |
| PRD-010 | Pakistan and US localization workstreams | Capability-level source, effective date, fixture and reviewer approval exist before enablement |
| PRD-011 | Upgradeable client customizations | Configuration/extensions upgrade in staging without modifying core source |
| PRD-012 | Explainable reports | Every financial total drills to dated, authorized source transactions |
| PRD-013 | Client-controlled exports and exit | Export includes data, attachments, schema, mappings and restore/build instructions |
| PRD-014 | Enterprise operating controls | Backups, monitoring, incident response, support boundaries and rollback/forward-fix paths demonstrated |

## Whole-product success targets
Proposed acceptance targets, not measured claims:
- Create a warm seeded demo in <=10 minutes; cold provisioning <=30 minutes on a documented reference environment.
- On common desktop reference hardware and network, 95% of tested routine list/detail interactions show usable content within 2 seconds.
- Server read p95 <=500 ms and ordinary non-batch command p95 <=1 second at the published load profile; measure document rendering, integrations and exports separately.
- A trained user produces a simple invoice in <=3 minutes after entering a valid customer and item.
- In moderated testing, >=90% of target users complete each of five core role tasks unaided; sample size and cohorts are recorded.
- Trial balance difference = zero; AR/AP/inventory control account reconciliation difference = zero.
- Zero unauthorized cross-organization records in negative test suites.
- Backup/restore RPO and RTO must meet the selected deployment tier; no universal uptime guarantee for arbitrary VPS hardware.
- Publish measured time saved per automation against a comparable manual baseline; include reviews, corrections and failed runs.

## Scope sequencing
Release scope is selected by business flow, not the visual existence of modules. GL plus AP without procurement can be valid; MRP without accurate stock and BOM revisions is not. Advanced planning, lending, full talent suite, process manufacturing, intercompany consolidation and regulated industry packs follow prerequisites. Desktop and mobile do not promise complete offline ERP.

## UX acceptance
Screens must answer: Where am I? What is the status? What requires my attention? What can I do? What happened? Documents expose totals, source links, approval status, validation and accounting impact before posting. Overloaded forms use progressive disclosure, not hidden mandatory data. See design-system.md.

## Sign-off and exclusions
Product owner approves scope; domain expert approves process logic; accountant approves accounting cases; localization specialist approves enabled local rules; security and QA approve release evidence. Professional certification, global statutory coverage, unlimited scalability and full equivalence to competitor suites are not automatic outcomes of this plan. Industry coverage is documented through fit-gap analysis and pack release notes.

