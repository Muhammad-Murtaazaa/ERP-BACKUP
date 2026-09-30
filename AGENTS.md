# Engineering instructions for the Omnysync ERP product
This specification defines the target product. These instructions apply when copied into its repository. The pack itself is documentation, not a working ERP implementation.

## Read before implementing
Read PRD.md, architecture.md, MODULE-CONTRACT.md, logic.md, FINANCIAL-CONTROLS.md, DATA-MODEL.md, design-system.md and the relevant module file. Respect the current release slice in IMPLEMENTATION-ROADMAP.md. Check OPEN-DECISIONS.md and do not invent localization facts or claim untested readiness.

## Non-negotiable rules
1. Never use JS floating-point numbers to calculate money, rates, tax or valuation. Use exact decimals; API decimal strings; validated currency scale and explicit rounding.
2. Never update or delete posted journals or stock valuation facts to fix history. Use an authorized reversal/correction.
3. Never bypass server permissions, organization/entity scopes, period locks, revision checks or posting rules in UI, scripts, imports, jobs or AI tools.
4. Runtime DB accounts must not be owner, superuser or BYPASSRLS. Keep migration credentials out of runtime.
5. Every monetary external side effect needs a durable intent, idempotency, unknown-outcome handling and reconciliation.
6. No direct writes to another module's tables. Use its application contract with the correct unit of work.
7. No client-specific core forks for settings, screens, mappings or workflows. Use versioned configuration/extensions.
8. No business mutation on a public GET route. No arbitrary SQL/JS in client custom formulas or workflow definitions.
9. Hide a control only after enforcing its permission on the server. Empty/denied/error states are part of the feature.
10. Include real accessible interaction: semantic labels, keyboard operation, focus restoration, announcement of async results and alternative actions to drag gestures.
11. Demo mode must disable live financial/statutory connectors. Do not seed from production records.
12. Do not make independent client runtime depend on the Omnysync console or telemetry.
13. Never claim statutory compliance from implemented fields alone. Validate sources, effective dates, fixtures and reviewer approval.
14. Keep security decisions, secrets and privileged native bridges out of client-controlled inputs.

## Workflow
- Identify requirement IDs and acceptance conditions before editing.
- Describe unresolved product choices in an ADR; proceed with documented reversible defaults within scope.
- Implement one vertical flow through UI/API/domain/database/audit/reporting rather than many stub screens.
- Add the meaningful regression tests required for financial, permission, concurrency and workflow changes. Reuse shared contract tests; avoid tests that merely restate implementation.
- Run type checks, lint, relevant unit/integration/contract/E2E checks, migrations against representative data, and applicable accessibility/visual checks.
- Record evidence in REQUIREMENTS-TRACEABILITY.md with actual build and test references.
- Update specs when behavior changes; do not renumber published requirement IDs.

## Code and data discipline
Strict TypeScript; validated boundary schemas; typed error codes; no unchecked casts in authorization or accounting paths. Date-only business dates are distinct from timestamps. Decimal serialization remains string end-to-end. Use optimistic revisions on editable records and lock/serialize competing allocations, reservations and posting. Log correlation IDs and redacted metadata, never passwords, tax identities, card data or payroll details.

Migrations are append-only after release. Include data migration verification, deployment sequencing and operational recovery. Review indexes, constraints and RLS for every scoped table. Avoid broad destructive resets, especially for independent client deployments. Seed files are deterministic and synthetic.

## UI discipline
Use shared tokens/components. Do not hardcode new spacing/color systems per module. Validate long content, high data density, small screens, reduced motion, 200% zoom, keyboard focus and RTL candidates. Financial totals align, state labels are human-readable and irreversible actions describe their effect.

## Definition of done
Requirement behavior and failure paths work; policies enforced; audit and reports correct; finance/inventory reconciled if affected; tests and accessibility pass; documentation and recovery instructions updated; no unresolved critical defect. Mark incomplete adapters and demo-only actions plainly.

