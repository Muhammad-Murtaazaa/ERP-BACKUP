# Administration, demos and domain console
Two distinct consoles: Omnysync control console and client administration inside each installation. Their identities, credentials and databases are separate.

## Omnysync console capabilities
Client/project registry; solution templates; industry/country selection; module dependency resolver; build/capability compatibility; synthetic seed packs; demo environment provisioning; users and role presets; subdomain/verified custom domain bindings; expiry/reset/archive; resource quotas; signed release publishing; optional deployment fleet health; permitted support sessions; audit and per-environment cost tracking.

A client installation can register release metadata without giving access to ERP data. Credentials/secrets are not shown as ordinary registry fields.

## Demo creation
1. Name environment, choose industry/template, release, locales, entity count and sample date.
2. Select features; expand hard dependencies and display optional capabilities.
3. Check readiness; unbuilt features are unavailable or distinctly demo_only.
4. Choose synthetic scenario and personas; disable external payment/statutory/real messaging actions.
5. Reserve a domain-safe slug and provisioning idempotency key.
6. Provision isolated database/storage/secrets and run compatible migrations.
7. Seed a deterministic interconnected dataset: opening balances, orders, receipts, invoices, stock, employees and pending tasks.
8. Verify auth, permission boundaries, reconciliations, links, widgets and domain TLS.
9. Mark ready only after checks; supply expiring role-specific credentials.
10. Expire/archive or reset through the same audited lifecycle.

## Domain binding
Demo subdomains use a configurable Omnysync-owned base domain, e.g. <slug>.demos.<your-domain>. No actual domain is assumed in this pack. Client production normally uses a client-controlled domain; a licensed Omnysync subdomain is optional, with portability documented.
- DNS/provider integration is an adapter; validate slug syntax, reserved names and uniqueness.
- Verify custom-domain ownership by challenge before binding. Use strict Host/SNI allowlist and trusted routing map.
- Issue/renew TLS with secret isolation; wildcard DNS does not itself create correct TLS/tenant routing.
- Prevent dangling DNS and subdomain takeover during retirement; remove routing/DNS bindings with audited order.
- Do not derive organization authorization solely from hostname. Authenticate installation membership.
- Return useful provisioning/verification errors; never reveal other customer environments.

## Users / access
Omnysync roles: console owner, solution architect, demo operator, release manager, support operator, auditor. Separate create-demo, reset-demo, manage-domain, publish-release and authorize-support actions. Demo personas are synthetic ERP users; console roles do not inherit production ERP roles.
Client roles are assigned by client administrators with scoped entity/branch/warehouse/department access. Invite, revoke, suspend, MFA/SSO settings and delegated access require audit. Client support requires explicit scope, expiry and reason; no invisible impersonation.

## Module toggle semantics
Enable: dependency and version validation -> migrations -> configuration checklist -> role grants review -> seed/reference data -> capability smoke tests -> activate. Disable: preview dependencies and business impact -> approve -> drain -> stop new triggers/schedules -> finish/cancel pending work -> preserve historical/correction capabilities -> enter read_only/disabled.
A module toggle never deletes data or reverses transactions. Disabling sales must not strand AR settlement; disabling HR must not erase payslip evidence. Reject dependency-breaking changes unless dependents also drain in a valid sequence.

## Environment operations
Pause demo resources, renew expiry, clone template configuration, reset seeds, inspect sanitized health, rotate demo credentials and archive evidence. Clone never copies production PII by default. Reset is asynchronous with a clear destructive target and progress; only demo-scoped credentials/services can perform it. Production reset route must not exist in the demo operator permission boundary.

## Release and ownership support
Build profile emits module/country/extension manifest, SBOM, license notices, schema compatibility and signatures. Client deployment receives a locally verifiable release bundle; any entitlement mechanism must support agreed offline operation and never remotely disable financial records. Handover includes domain/DNS transfer options.

## Acceptance tests
Same-slug concurrency creates one binding; duplicate provision creates one environment; invalid capability set cannot deploy; TLS renew/revoke lifecycle works; expired credentials fail; demo connector cannot initiate real payment/filing; reset cannot address production; central outage leaves client operational; support access revocation immediately invalidates permitted sessions; historical balances remain readable after module disable.

