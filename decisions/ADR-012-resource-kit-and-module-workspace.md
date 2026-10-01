# ADR-012 — Shared resource kit (API) and ModuleWorkspace (UI) for catalogue modules
Status: accepted • 1 October 2026

## Decision
The modules built in the overnight round 2 are SRV, CRM, TIM, SUP, LOG, BI, DOC, FLT, COM, EPM, LND, GRC and TAL. They are declared with `defineResource` (`apps/api/src/lib/resource.ts`) instead of hand-written CRUD. The kit gives every resource the same behaviour:

- Typed field parsing: string, decimal, int, date, enum and org-scoped ref. A missing or foreign ref returns 400 with `details.field`.
- List with search, filters and paging.
- Detail extensions.
- Optimistic `revision` on update.
- State-machine `commands`, each with permission, allowed `from` states, input fields, and an optional `sodColumn` for segregation of duties.
- Document numbering, audit log and outbox event.
- `requireModule` lifecycle guards: a draining module blocks creates only.

Business rules live in `beforeCreate`/`beforeUpdate`/`run` hooks inside one unit of work. Postings always go through `postJournal` or `createPostedSourceInvoice` with an idempotent `sourceKey`, so the period guard and double-post protection come from the core.

The web side uses `ModuleWorkspace` (`apps/web/src/views/kit/ModuleWorkspace.tsx`): KPI tiles, tabs, a status filter, tables, and a Drawer for detail and actions, with Combobox refs. Each view is a declarative `TabDef[]` plus small custom panels. Examples are the billing run, budget variance, GRC heatmap and recruitment board.

## Consequences
- Every module gets consistent UX and controls at low cost, and tests focus on business edge cases.
- Highly bespoke screens still need custom panels.
- The kit assumes one status column per table.
