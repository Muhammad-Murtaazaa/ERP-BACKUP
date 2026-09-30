# Deployment, native clients and operations
Every supported profile includes a published sizing/load envelope, security configuration, backup policy and tested restoration. Client VPS is supported within this envelope; arbitrary single-server hosting cannot promise high availability.

## Profiles
| Profile | Topology | Proposed recovery target, subject to measured rehearsal |
| --- | --- | --- |
| Demo | Isolated disposable ERP with synthetic data | Recreate seed/config; no production retention guarantee |
| Client starter | Single VPS, app/API/worker, PostgreSQL and storage adapters | RPO <=24h with daily backup; RTO <=8h; single-host outage expected |
| Client business | Separate DB/storage, WAL/PITR, monitored workers | RPO <=15min; RTO <=4h |
| Client critical | Redundancy/failover/PITR/separate backup boundary | RPO <=5min; RTO <=1h after measured qualification |
| Air-gapped / LAN | Client-local runtime and approved offline release transport | Targets selected by customer-managed infrastructure and drill |
These are proposed tier targets, not delivered SLAs. HA and DR are different. Measure full recovery including secrets/files/identity/DNS and reconciliation.

## Minimal runtime
Reverse proxy/TLS; static web; API; worker; supported PostgreSQL; file adapter; durable job/outbox storage; client-controlled secrets; logs/metrics; backup scheduler. Docker Compose candidate for small installations. Optional identity provider/cache/Temporal/search/analytical store added only when needed. No Kubernetes requirement.

Publish pinned images/artifacts, checksum/signature, SBOM/license notices, schema version, module/localization/extension manifest, environment-variable reference and dependency compatibility. Use least-privilege service identities; no database public exposure by default.

## Install sequence
Verify client ownership/credentials/domain and fit-gap -> qualify infrastructure -> restore-test backup destination -> configure secrets/identity/TLS -> deploy supported release -> migrate -> enable selected modules -> onboarding/migration -> reconciliations -> acceptance -> handover. Live connector enablement requires separate reviewed credentials/readiness, not just a server success screen.

## Offline matrix
| Action | Connected requirement | Offline behavior |
| --- | --- | --- |
| View cached records | Current permission on refresh | Minimal approved encrypted cache with age/scope label |
| Draft forms/notes | Final validation online | Queue draft with stable ID and explicit pending state |
| Field photos/checklists/time | Server acceptance online | Bounded capture and conflict review |
| Warehouse scans/POS | Only with qualified device/country policy | Signed bounded intents; stock/tax/payment limitations explicit |
| Post journals/invoices/payroll | Authoritative server | Prohibited offline final posting |
| Approve/release money or statutory filings | Authoritative server + connector state | Prohibited offline final action |
| Change permissions/modules/financial mappings | Authoritative server | Prohibited offline activation |

Desktop is a connected native wrapper, not a separate SQLite accounting system. Mobile is role-focused. LAN server without internet can support local commands; external banking/tax functions may be unavailable and must follow jurisdiction-approved contingency, not silently bypass reporting.

## Backup and restore
DB base backups + WAL/PITR for selected tier; consistent files/metadata snapshots; versioned release/config/extensions; identity configuration; encryption keys with separated recovery; safe secret backup; DNS/domain documentation. Test restoration to a clean isolated host and verify journal/subledger/stock totals and file access. Keep backups off the failure domain with access controls and retention. Backups without usable keys/compatible build are incomplete.

## Monitoring
Health/liveness vs readiness separate. Monitor API latency/errors, DB locks/connection/storage, backup age, WAL/archive lag, outbox/job lag, failed/unknown provider intents, TLS expiry, reconciliation differences, extension failures, native version skew and resource quotas. Alerts have accountable owner/severity/action; logs redact HR/finance payloads.

## Incidents
Contain/revoke access -> preserve evidence -> assess source-of-truth/provider effects -> recover -> reconcile -> client-authorized communications -> postmortem/remediation. Unknown monetary effects are resolved before re-execution. Single VPS loss follows clean-host restore, not untested copying of a live DB directory.

## Upgrades and rollback
Client-approved release channel; staging rehearsal with representative data; backup + restore qualification; expand/migrate/contract; capability feature flags; smoke/reconciliation checks; monitored promotion. Database rollback may be unsafe after new writes; use forward fix or restore-with-reconciliation according to reviewed plan. Never run a destructive down migration merely because old app code was rolled back. Native/API compatibility window prevents simultaneous forced update.

## Handover / termination
Transfer client credentials, build/source materials under contract, schema, data/files, backup/restore and operating runbooks. Disable Omnysync management without stopping ERP. Migrate provider/domain accounts where agreed. Include removal of secrets/support access and a complete portable export. Client can appoint another operator.

