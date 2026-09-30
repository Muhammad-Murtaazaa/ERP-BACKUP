# Customization, extensions and onboarding

**Module ID:** customization-platform  
**Prefix:** CFG  
**Readiness:** planned; scope-specific verification required  
**Hard dependencies:** [platform](platform.md)

## Workflow and entities
Configure -> validate/simulate -> approve/publish -> onboard -> upgrade.
Owned entities: Configuration/version, custom schema, formula, template, extension, checklist, migration batch. Separate operators, process owners, approvers, administrators and auditors; portal users access only their authorized party records.

## Controls
Versioned configuration over core forks; finance/permission requirements cannot be hidden by form rules.
All rows inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [SECURITY.md](../SECURITY.md), [logic.md](../logic.md) and relevant financial/localization rules.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| CFG-001 | Configuration layers | Define default/country/industry/entity/role precedence | No user override of financial policy |
| CFG-002 | Custom fields | Type/validate/scope/sensitivity | Cross-scope reference rejected |
| CFG-003 | Custom objects | Define state/audit/permission/retention | No direct journal mutation |
| CFG-004 | Form layouts | Configure allowed sections/visibility | Mandatory input has valid source |
| CFG-005 | Terminology | Translate safe client vocabulary | Canonical contract names stable |
| CFG-006 | Branding | Apply constrained tokens/assets | Contrast validation before publish |
| CFG-007 | Templates | Version print/email/document designs | Issued version preserved |
| CFG-008 | Navigation | Expose authorized enabled tasks | Hidden menu not security substitute |
| CFG-009 | Dashboards | Apply governed role/personal layouts | Metric permissions enforced |
| CFG-010 | Rules | Use sandboxed typed expressions | No eval/SQL |
| CFG-011 | Publish | Validate/simulate/review config diff | Ambiguity blocks activation |
| CFG-012 | Rollback | Change future behavior with compatibility | Posted history unchanged |
| CFG-013 | Extension SDK | Declare hooks/data/grants/versions | Unreviewed code not installed |
| CFG-014 | Compatibility | Test extension upgrade/deprecation | Unsupported hook gated |
| CFG-015 | Config export | Portable redacted versioned settings | Secrets not in ordinary export |
| CFG-016 | Setup wizard | Guide industry/entity/COA/modules | Readiness checklist blocks premature activation |
| CFG-017 | Import staging | Map/validate/dry-run source rows | Bad row evidence actionable |
| CFG-018 | Opening migration | Commit approved reconciled baseline | Rerun does not duplicate balance |
| CFG-019 | Contextual help | Show role/readiness-aware guidance | Unavailable feature not presented ready |
| CFG-020 | Upgrade preview | Diff schemas/rules/config dependencies | Client extensions tested before deploy |

## UI, reports and automation
Use scoped task workspace/list/detail/editor, accessible approval or execution panel, timeline, settings, authorized imports/exports and contextual help. [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) define shared behavior. [REPORTING.md](../REPORTING.md) governs metric definitions, date/currency basis and drill-through. Events use committed outbox facts; actions run scoped identities and durable intents under [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Optional adapters have explicit qualification and failure handling.

## Tests and lifecycle
Domain cases: Malicious formula; missing mandatory field; incompatible extension; rerun opening import.
Also verify field/scope denial, duplicate event/command, stale revision, unavailable dependency, worker crash, conflicting effective date and retention. Schema/API detail is expanded during the chosen slice. Enable requires compatible dependencies/configuration/coverage. Disable drains outstanding work while retaining legal history and authorized correction/settlement. Specialized regulated capabilities remain unavailable until their separate gate passes.

