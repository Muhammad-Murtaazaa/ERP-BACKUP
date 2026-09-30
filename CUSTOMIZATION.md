# Configuration and extension system
Reuse should produce client-specific behavior without fragmenting the product.

## Customization layers
1. Product defaults.
2. Country pack defaults.
3. Industry pack templates.
4. Installation/organization/entity approved configuration.
5. Role defaults.
6. User presentation preferences.

Define field-level precedence and merge semantics; financial policy does not become overrideable through a user preference. Store version, author, approver, effective date, dependency and rollback compatibility for each published configuration.

## Configurable areas
Organization/entities/branches; module/capability availability; roles/scopes; document numbering; COA and purpose mappings; fiscal calendars; currencies; tax classes; terms/discounts/credit rules; warehouse/valuation policies; workflow thresholds; dashboards/reports; navigation; form sections/custom fields; document/email templates; notification channels; translations; terminology; approval matrices; automation quotas and integration credentials.

## Dashboard personalization
Governed dataset catalog; allowed metrics/dimensions; widget palette; responsive layouts; role templates; personal/shared workspaces; filters and drill-through; subscriptions; export; preview and version history. Accessible move/resize alternatives required. Applying a filter cannot broaden authorization. Metrics declare currency, aggregation method, time basis and exclusions.

## Custom objects / fields
Typed fields: string/enum/decimal/date/reference/boolean/file with validation, visibility, sensitivity, required-on-state and reportability. Referenced records enforce same scope. Custom objects have defined CRUD, state policy, audit, permission and retention. Custom financial objects can only post through registered typed accounting intents and approved mappings.

Do not add arbitrary fields directly into journal facts or change statutory forms without policy review. Sensitive fields are excluded from indexing/exports/AI by default. Client field deletion may hide/archive but must preserve historical document snapshots.

## Workflow and rules
Typed declarative DSL; validated inputs/operators/actions; bounded loops/timeouts; dry run; versioned publishing; effective dates; segregation checks and restricted external action adapters. Formula language is sandboxed with limits and governed field references, never eval or arbitrary SQL. Money functions use exact decimals and approved rounding.

## Extension SDK
Manifest declares ID/version, minimum platform API, dependencies, permissions, owned data, hooks, UI slots, jobs, events, localization and migration compatibility. Extensions execute through permissioned ports; no unsupported direct DB mutation. Server extensions installed only after code/license/security review; browser extensions obey CSP and cannot receive secrets. Client-specific code resides in a separate extension package with handover and compatibility tests.

## Branding and forms
Approved logo/colors, locally served assets, terminology, print/email templates and constrained layout slots. Contrast validator and preview in normal/long/translated/error states. Form builder cannot hide mandatory regulatory/accounting input without an equivalent valid source/default. Published templates snapshot version on issued documents; generated PDF remains retrievable under retention.

## Publishing / upgrades
Draft -> validate -> simulate -> approve -> publish -> monitor. Rollback changes future behavior; it does not reinterpret completed transactions. Upgrade compares field/rule/schema versions, detects removed hooks and quarantines incompatible extension capabilities. Installation config exports/imports are portable with secret placeholders and redacted IDs; secrets transferred separately.

## Acceptance
A trading and service client share unchanged core source but have different terminology, dashboards, account mappings and approval policies. Upgrade both in staging and run source-to-pay/order-to-cash reconciliations. Permission tests include custom fields/widgets/exports. Reject malicious formulas, dangling references, ambiguity, invalid color overrides and removal of mandatory fields.

