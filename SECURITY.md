# Security, privacy and access boundaries
Proposed baseline: map release controls to a pinned OWASP ASVS version and a documented verification level suited to the deployment; independently assess high-risk flows. Source: [OWASP ASVS](https://owasp.org/projects/asvs). This document is a design, not a completed certification.

## Threat boundaries
Browser/native device; public API; ERP runtime; migration/admin credentials; client database/storage; worker/AI/connector; Omnysync control plane; third-party service; backups and exported files. Principal threats: cross-scope access, privilege escalation, account takeover, forged webhook, duplicate payment, SQL/XSS/template injection, SSRF, malicious uploads, stolen native token, prompt injection and privileged-owner alteration.

## Authentication and authorization
OIDC/SAML where configured; strong MFA for privileged roles; secure password storage for supported local auth; recovery audit; revocable sessions and service credentials; short-lived tokens with explicit refresh/revocation behavior. Web cookies HttpOnly/Secure/SameSite with CSRF protection where needed. Native refresh secrets use platform secure storage, not ordinary persisted app state.

Server resolves membership and scopes on every route/command/job. Role grants never replace entity/field access or segregation. Recheck financial authorization at execution. Delegated/support actions record real and acting actors. Permission changes invalidate relevant sessions/caches/search access on defined bounded latency; critical disbursement rechecks authoritative grants.

## Database isolation
Organization-safe composite FKs and RLS on scoped tables. ENABLE and FORCE policies as appropriate. Runtime role is not owner/superuser/BYPASSRLS and cannot grant roles or disable policies. Migration account distinct/offline to runtime. Set trusted organization context transaction-locally with connection pooling reset; no user-controlled SQL/context-setting endpoint. PostgreSQL owners and privileged roles can bypass policies; do not present RLS as protection from a hostile DB owner. See [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

Test RLS under actual runtime credentials, including joins, bulk queries, jobs, exports, search and all organizations. Application enforces finer entity/department/record/field rules. Prefer restricted policies and beware unintended OR expansion across permissive policies.

## Application defenses
Validated schemas, parameterized SQL, output encoding, strict CSP, safe template renderer, input limits, rate limiting, protected admin routes, narrow CORS, dependency scanning and secret detection. No public arbitrary SQL/eval/template execution. Attachment types/sizes checked; virus scan/quarantine; serving policy prevents active content execution. URLs to connectors/AI import constrained by SSRF allowlists; block private/metadata endpoints and revalidate redirects/DNS according to adapter needs.

## Secrets / encryption
TLS in transit; encrypted disks/backups/object storage and approved field-level protection for selected data. Keys are client-controlled or explicitly delegated; recovery/rotation included. Secrets stored separately from ordinary configuration/export and logs. Short-lived scoped provider credentials preferred. Maintain revocation/rotation runbooks and no fixed shared administrator password.

## Native and offline clients
Allowlist bridge capabilities such as printing/scanning/files; remote untrusted content must not acquire shell/file privileges. Signed desktop/mobile builds and updates, explicit installation endpoint verification and tenant-aware deep links. OS secure storage for tokens; encrypted minimized local caches with expiry/logout/device revoke handling. A lost offline device cannot instantly receive revocation, so offline authority/expiry and queued-command server rechecks are bounded. See [Tauri capabilities](https://v2.tauri.app/security/capabilities/) and [React Native security](https://reactnative.dev/docs/security).

## Support and control plane
No automatic production ERP access from console identity. Client authorizes scoped time-limited support or approved managed-service policy; log session/reason, optionally notify client, and revoke at expiry. Optional management agent is outbound, authenticated and restricted; remote commands allowlisted. No central mechanism silently suspends accounting/data access in an independent installation.

## Audit and tamper evidence
Append-only application audit with protected actor/time/source/configuration fields; redact sensitive changes or encrypt evidence for authorized reviewers. Independent backups or write-protected audit export improve resistance. Hash chains detect some modifications only when checkpoints are protected separately; cannot defeat a fully privileged owner who controls every copy. Record accesses/exports of sensitive bulk data.

## Privacy, AI and retention
Data inventory by classification; minimal collection, purpose, region and lawful review; customer-authorized provider processing; scoped retrieval and model data policy. Do not leak record existence through totals/errors/snippets. HR reports suppress small groups where policy requires. Define financial/HR/operational/demo/log classes with retention, hold and erasure. Apply tombstones to restored archives when required. No universal Pakistan/US privacy compliance claim.

## Release gates
Threat model + auth/scope/SoD tests; real-role RLS tests; injection/upload/SSRF/webhook/native tests; dependency/SBOM/license checks; privileged access review; backup/key recovery; incident runbook; independent assessment for payments/payroll or regulated packs. Critical defects block release.

