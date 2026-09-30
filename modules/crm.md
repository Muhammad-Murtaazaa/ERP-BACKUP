# CRM, marketing and customer lifecycle

**Module ID:** crm  
**Prefix:** CRM  
**Readiness:** planned; individual verification required  
**Hard dependencies:** [platform](platform.md)

## Workflow and entities
Acquire -> consent/qualify -> opportunity -> quote -> win/handover -> retain.
Owned entities: Lead, contact, account, opportunity, campaign, consent, activity, forecast. Assign operator, approver, administrator and read-only analyst roles with scoped actions; refine job-specific roles during fit-gap.

## Controls
Privacy/consent applies at outreach delivery; AI scores are advisory.
All features inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [logic.md](../logic.md), [SECURITY.md](../SECURITY.md) and relevant [FINANCIAL-CONTROLS.md](../FINANCIAL-CONTROLS.md). Optional cross-module integrations are declared separately; operational-only modes must be explicit.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| CRM-001 | Lead capture | Capture source/consent from forms/import/API | Duplicate candidate enters review |
| CRM-002 | Deduplication | Review merge candidates and relationship impact | Merge preserves provenance |
| CRM-003 | Accounts/contacts | Track organization relationships and communication roles | Shared identity grants no added access |
| CRM-004 | Qualification | Configure stage criteria and disqualification | Required evidence enforced |
| CRM-005 | Pipeline | Track stage/value/currency/owner/next action | Aggregation uses explicit conversion |
| CRM-006 | Activities | Assign calls/tasks/meetings and outcomes | Reassignment retains actor evidence |
| CRM-007 | Communications | Link approved channel history | Restricted content protected |
| CRM-008 | Campaigns | Segment authorized consented audiences | Unauthorized fields excluded |
| CRM-009 | Consent | Record preferences/source/withdrawal | Opt-out enforced at send time |
| CRM-010 | Lead routing | Assign by geography/product/capacity | Replay assigns once |
| CRM-011 | Quote handoff | Create source-linked quote | Accepted version identifiable |
| CRM-012 | Forecast | Separate pipeline/committed/won basis | Opportunity counted once |
| CRM-013 | Territories | Scope ownership and routing | No implied cross-account access |
| CRM-014 | Account health | Define transparent signals | Inputs/freshness/missing data shown |
| CRM-015 | Renewals | Assign milestone tasks | Closed renewal not recreated |
| CRM-016 | AI summaries | Draft scoped notes/next actions | External send requires authorized policy |
| CRM-017 | Attribution | Define source/campaign model | Correlation not presented as causality |
| CRM-018 | Success plans | Track onboarding/adoption/risks | Handover has owner and open actions |

## UI, reports and automation
Implement a role workspace, scoped lists, source-linked editor/detail, approval/execution panel, history, settings, attachments, contextual help and permitted import/export. Use [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) and [design-system.md](../design-system.md). Reports use governed metrics, dates/currencies and source drill-through in [REPORTING.md](../REPORTING.md). Emit committed domain events via outbox; automate reminders/routing/proposals with bounded identities per [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). External adapters need dedupe, unknown-outcome reconciliation and validated readiness.

## Validation and lifecycle
Required domain cases: Duplicate contacts; opt-out; hidden account; double-counted forecast.
Also test forbidden scope, stale revision, replay, unavailable dependency, worker failure and retention. Expand physical schema/API contracts for selected release under [DATA-MODEL.md](../DATA-MODEL.md) and [API-AND-EVENTS.md](../API-AND-EVENTS.md). Enable validates prerequisites/country/configuration. Disable drains open work and retains historical/settlement/correction access; it never purges business facts.

