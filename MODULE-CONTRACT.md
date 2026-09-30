# Universal module contract
Every feature in every module inherits this contract. A feature table row adds domain-specific behavior and one minimum acceptance check; it does not waive any requirement below.

## Feature delivery checklist
| Area | Required contract |
| --- | --- |
| Identity | Stable requirement ID, owning module, product release and capability readiness |
| Authorization | Named permission for view/create/update/approve/post/reverse/export/admin; organization/entity/field scope |
| Data | Explicit entities and relationships, immutable snapshots where needed, tenant-safe FKs and retention class |
| Validation | Server schemas, business invariants, effective dates, duplicate rules, understandable field errors |
| State | Allowed transition map, actor, prerequisites, cancellation/correction and revision policy |
| Concurrency | Optimistic revision for edits; locks or serializable invariants for contested value/quantity |
| Audit | Actor, delegated identity, time, scope, before/after or protected evidence, reason, correlation and configuration version |
| API | Command endpoints, typed errors, idempotency for retriable mutations, pagination and filter limits |
| Integration | Outbox event schema, inbox dedupe, retries, dead-letter handling, replay and reconciliation |
| Finance | Accounting purpose, book/entity/date, approved mapping version, balanced posting and control reconciliation |
| Inventory | Quantity/UOM/lot/serial, location, valuation date, reservations and stock availability rules |
| UX | List/detail/create/edit/approval/history, loading/empty/denied/stale/error/conflict/offline states |
| Accessibility | WCAG 2.2 AA target, keyboard, screen reader, focus, labels, no color-only meanings |
| Reporting | Metric definition, source fields, scope and as-of time, drill-through and export policy |
| Migration | Validated mapping, dry run, source row evidence, deterministic correction and reconciliation |
| Operations | Job quotas, timeout, telemetry redaction, health behavior and recovery runbook |
| Testing | Happy path, authorization denial, invalid input, stale revision, duplicate retry, failure and domain edge cases |
| Help | Purpose, first-use guide, contextual explanation, sample data only in demo/sandbox |
| Packaging | Manifest, version, dependencies, country capabilities, seeds and uninstall/read-only strategy |

## Standard record actions
Draft: save, duplicate with safe resets, archive if allowed, validate and submit. Submitted: approve/reject/request changes, withdraw under policy. Approved: execute/post only after command-time revalidation. Posted: inspect, export, reverse/correct, never arbitrary edit. Archived records remain available according to retention and permissions. Customer/vendor/employee master changes are effective-dated or audited; identifiers referenced in legal documents are snapshotted.

## Shared UX features inherited by all suitable modules
Advanced filters; search; sorting; saved personal/shared views; column order and widths; density controls; pagination; bulk action preview; import/export with permission; attachments; record timeline; comments/mentions with authorized recipients; subscription preferences; related records; contextual help; accessible keyboard shortcuts; task inbox; localization of dates/numbers; exact decimal entry; printable templates; activity notifications; audit inspection. Bulk actions return per-record results and cannot silently skip unauthorized failures.

## Permission construction
Convention: module.resource.action. Examples: finance.journal.post, inventory.transfer.execute, hr.employee.sensitive.read. Roles compose grants but do not erase scope. Explicit denies and segregation-of-duties rules win. Delegation has a scope, date window, actor trail and prohibited privilege-escalation list.

## Module lifecycle
available -> installed -> configuring -> enabled -> draining -> read_only -> disabled.
Failure and maintenance are separate runtime states. Enabling requires dependencies, migration completion, settings, localization readiness and permissions. Draining blocks new roots, permits controlled completion of existing work, stops new schedules and surfaces blockers. Historical reads, exports, audit, settlement and corrections require explicit retained capabilities; disabling a menu must not disable legal access. Uninstall/data purge is an exceptional retention-governed operation, not a toggle.

## Capability readiness
planned -> implemented -> verified -> pilot -> production.
demo_only and retired are alternate statuses with visible labels. UI navigation and APIs use capability-level readiness. A module can be enabled with verified basic invoicing while advanced revenue recognition is unavailable. Manifests never mark an unbuilt capability production.

## Required module documentation
Purpose and personas; hard/optional dependencies; entity list and ownership; canonical workflow; feature requirements; domain invariants; automation; dashboards/reports; integration contracts; security/retention; tests and module-on/off behavior. Module files in this pack implement this structure at planning depth; physical fields/API schemas are elaborated when the release slice is selected.

