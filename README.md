# Omnysync Enterprise Platform — specification pack
Version 0.1 • 30 September 2026 • Status: proposed engineering baseline

## Purpose
Build Omnysync's reusable flagship ERP product and internal module library. Assemble credible demos and independently owned client installations without rebuilding finance, permissions, UI, workflows, or integrations each time. Deliver a coherent product rather than a collection of screens.

## Confirmed direction
- Own platform; TypeScript, React, PostgreSQL.
- Each production client can operate an independent installation on client-controlled infrastructure, including a VPS.
- Web, connected desktop, and connected mobile experiences share the same authoritative backend.
- Omnysync operates a separate console for demos, templates, build assembly, and permitted deployment management.
- Pakistan and US localization are launch workstreams.
- Broad cross-industry capabilities, automation, adjustable modules, four-level COA, excellent accessibility and usability.

Client ownership must be made contractual: ownership of data, infrastructure, credentials, source access, customization IP, and reusable core IP are separate decisions. This pack specifies full operational independence and handover; exclusive assignment of the reusable core remains an open commercial decision. See OWNERSHIP-AND-HANDOVER.md.

## Read first
1. [PRD.md](PRD.md) — scope, outcomes, readiness and release gates.
2. [architecture.md](architecture.md) — deployment, runtime, boundaries and repository.
3. [logic.md](logic.md) — commands, state transitions and end-to-end rules.
4. [FINANCIAL-CONTROLS.md](FINANCIAL-CONTROLS.md) and [COA.md](COA.md) — posting and four-level accounts.
5. [MODULE-CATALOG.md](MODULE-CATALOG.md) — every module, dependencies and feature totals.
6. [design-system.md](design-system.md) and [UX-SCREEN-SPECS.md](UX-SCREEN-SPECS.md).
7. [IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md) and [TEST-STRATEGY.md](TEST-STRATEGY.md).
8. [AGENTS.md](AGENTS.md) — development and coding-agent rules.

## Supporting specifications
- [DATA-MODEL.md](DATA-MODEL.md), [API-AND-EVENTS.md](API-AND-EVENTS.md), [MODULE-CONTRACT.md](MODULE-CONTRACT.md)
- [ADMIN-CONSOLE.md](ADMIN-CONSOLE.md), [SECURITY.md](SECURITY.md), [DEPLOYMENT-AND-OPERATIONS.md](DEPLOYMENT-AND-OPERATIONS.md)
- [AUTOMATION-AND-AI.md](AUTOMATION-AND-AI.md), [CUSTOMIZATION.md](CUSTOMIZATION.md)
- [ONBOARDING-AND-MIGRATION.md](ONBOARDING-AND-MIGRATION.md), [LOCALIZATION.md](LOCALIZATION.md)
- [INDUSTRY-PACKS.md](INDUSTRY-PACKS.md), [REPORTING.md](REPORTING.md)
- [REQUIREMENTS-TRACEABILITY.md](REQUIREMENTS-TRACEABILITY.md), [OPEN-DECISIONS.md](OPEN-DECISIONS.md)
- [research/SOURCES.md](research/SOURCES.md) and [research/BENCHMARK-MAPPING.md](research/BENCHMARK-MAPPING.md)
- examples: [module-manifest.example.json](examples/module-manifest.example.json), [deployment-profile.example.json](examples/deployment-profile.example.json), [posting-cases.md](examples/posting-cases.md).
- [decisions/ADR-001-platform-boundaries.md](decisions/ADR-001-platform-boundaries.md).

## Specification conventions
MUST = release-blocking requirement. SHOULD = default with an explained exception. MAY = optional capability. Every feature row is a proposed requirement, never a claim that software already implements it. Requirement IDs are stable: module prefix + three-digit sequence. Expansion does not renumber existing IDs.

Feature rows specify behavior plus a minimum acceptance condition. MODULE-CONTRACT.md supplies universal requirements for permissions, data scoping, validation, concurrency, audit, UX, imports, exports, API, reporting, and accessibility. A module specification adds entities, states, controls, integrations, automation and failure cases. This is a broad baseline, not proof of exact feature parity with every edition, extension or industry product from SAP, Oracle or NetSuite. Benchmarks inform coverage; the specification is Omnysync's own design.

## Development rule
No feature is production-ready because its happy-path demo works. Financial and inventory invariants, permission boundaries, recoverability, localization validation and accessible interaction must pass first. Do not implement this entire catalog as one release. Select an industry flow, complete its dependencies, and pass its gates.

## Suggested first product slice
Platform + GL/COA + tax foundations + AR/AP + sales + procurement + inventory + banking + dashboards + workflow + onboarding. Deliver a wholesale/trading demo and an independently operated client deployment. Develop Pakistan and US country packs concurrently but enable only individually validated capabilities. The full catalog is the destination.


## Detailed engineering references
- [DATA-DICTIONARY.md](DATA-DICTIONARY.md) — canonical core fields and elaboration gate.
- [DATABASE-TRANSACTIONS.md](DATABASE-TRANSACTIONS.md) — atomic posting/allocation/stock/payment/close sequences.
- [PERMISSIONS-MATRIX.md](PERMISSIONS-MATRIX.md) — role templates and segregation.
- [STATE-MACHINES.md](STATE-MACHINES.md) — guards, effects and truthful status labels.
- [INTEGRATION-CATALOG.md](INTEGRATION-CATALOG.md) — adapter boundaries and qualification.
- [OWNERSHIP-AND-HANDOVER.md](OWNERSHIP-AND-HANDOVER.md) — ownership rights and client independence.
- [VALIDATION.md](VALIDATION.md) — specification consistency evidence.

## Pack size
33 module specifications and 699 numbered module feature requirements, plus the linked universal controls and engineering references.
