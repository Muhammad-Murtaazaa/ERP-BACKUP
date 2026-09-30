# Administration, demos and deployment console

**Module ID:** admin-demo  
**Prefix:** ADM  
**Readiness:** planned; scope-specific verification required  
**Hard dependencies:** [platform](platform.md)

## Workflow and entities
Configure template -> resolve -> provision/seed/verify -> share -> expire/reset.
Owned entities: Template, environment, domain, build, release, deployment policy, support session. Separate operators, process owners, approvers, administrators and auditors; portal users access only their authorized party records.

## Controls
Separate client and Omnysync control planes; client remains operational if console unavailable.
All rows inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [SECURITY.md](../SECURITY.md), [logic.md](../logic.md) and relevant financial/localization rules.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| ADM-001 | Client registry | Track solution/deployment metadata | No implicit access to ERP data |
| ADM-002 | Templates | Version industry/country/module seed packs | Compatibility validated |
| ADM-003 | Assembly | Resolve dependencies/readiness | Invalid selection rejected |
| ADM-004 | Provisioning | Track durable installation phases | Retry creates one environment |
| ADM-005 | Synthetic seed | Create connected demo scenarios | No production PII used |
| ADM-006 | Persona users | Issue expiring role-scoped demo access | Expired credential blocked |
| ADM-007 | Subdomains | Reserve approved slug/base-domain binding | Concurrent slug unique |
| ADM-008 | Custom domains | Verify ownership before route/TLS | Unverified domain not bound |
| ADM-009 | TLS | Issue/renew/revoke with safe keys | Failed renewal alerted |
| ADM-010 | Routing | Use trusted host/installation map | Host alone not authorization |
| ADM-011 | Module enable | Migrate/configure/verify/activate | Missing prerequisite blocks |
| ADM-012 | Module disable | Drain open work and keep history | Toggle never purges data |
| ADM-013 | Reset | Destroy/reseed only isolated demos | Production target impossible |
| ADM-014 | Expiry | Pause/archive by policy | Domain retired without takeover path |
| ADM-015 | Cloning | Copy approved config/synthetic seeds | No secret/PII inherited |
| ADM-016 | Quotas | Limit environments/storage/compute | Failure leaves known state |
| ADM-017 | Releases | Publish signed build/SBOM/license manifest | Tampered release rejected |
| ADM-018 | Fleet health | Opt-in sanitized outbound agent | Client controls access/revocation |
| ADM-019 | Support | Require scope/expiry/reason/client policy | No permanent hidden login |
| ADM-020 | Audit/cost | Track console actions/resources | Sensitive client data absent |
| ADM-021 | Portability | Offer independent install/handover | Console disconnect not stop transactions |
| ADM-022 | Domain retirement | Remove bindings/DNS safely | Dangling record risk reviewed |

## UI, reports and automation
Use scoped task workspace/list/detail/editor, accessible approval or execution panel, timeline, settings, authorized imports/exports and contextual help. [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) define shared behavior. [REPORTING.md](../REPORTING.md) governs metric definitions, date/currency basis and drill-through. Events use committed outbox facts; actions run scoped identities and durable intents under [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Optional adapters have explicit qualification and failure handling.

## Tests and lifecycle
Domain cases: Same slug race; duplicate provision; demo reset production; central outage.
Also verify field/scope denial, duplicate event/command, stale revision, unavailable dependency, worker crash, conflicting effective date and retention. Schema/API detail is expanded during the chosen slice. Enable requires compatible dependencies/configuration/coverage. Disable drains outstanding work while retaining legal history and authorized correction/settlement. Specialized regulated capabilities remain unavailable until their separate gate passes.

