# APIs, commands, events and integration contracts
Versioned REST command/query APIs are the default; shared schemas generate typed clients. GraphQL is optional after authorization/query-cost review, not necessary for launch.

## Command envelope
organization_id is resolved against authenticated membership; legal_entity_id must be permitted. Client-provided IDs alone never establish scope. Include request_id, idempotency_key for retriable side effects, expected_revision for edits/transitions, source references and typed payload. Money/rates/quantities use decimal strings. Business dates are ISO date-only values; instants have explicit offsets/UTC.

Example route patterns: POST /v1/invoices; PATCH /v1/invoices/{id} with revision; POST /v1/invoices/{id}/submit; POST /v1/invoices/{id}/post; POST /v1/invoices/{id}/credit-notes; POST /v1/payment-intents/{id}/authorize; GET /v1/journals/{id}. These are contract conventions, not implemented endpoints.

## Results and errors
Successful commands return command_id, source_id, revision, state axes, journal/movement references, job ID if asynchronous and correlation ID. Typed failures include safe message, code, field paths, retryability, latest_revision and remediation. Use HTTP 401/403/404 according to anti-enumeration policy; 409 state/revision/idempotency conflicts; 422 validated business errors; 429 quotas; 5xx unexpected failures. An accepted asynchronous job is not a completed payment.

## Idempotency
Scope key to organization/actor or approved service identity/operation. Persist payload hash, status and result with the command unit of work. Same key + same payload returns prior outcome; different payload conflicts. Do not expire a financial dedupe record while retries/provider references could reappear. A crash between intent and external outcome leaves a durable unknown state, not a new unkeyed retry.

## Queries
Cursor pagination with stable sort/key; filter allowlist; bounded date ranges/aggregations; scope/field policy applied before data leaves server. Include as-of/refresh watermark for read projections. Export routes enforce current field permissions; expired link alone is not the only check. File downloads use narrowly scoped expiring grants and current authorization under policy.

## Event envelope
event_id, event_type, schema_version, organization_id, legal_entity_id if applicable, aggregate_id/type/revision, occurred_at, business_date, actor/service identity, correlation_id, causation_id, configuration_version and typed payload. Payload contains minimal facts/references, not unnecessary salaries, secrets or attachments.

Examples: invoice.posted.v1, stock.received.v1, payment.settlement_confirmed.v1, payroll.posted.v1, purchase_order.approved.v1, production.completed.v1, module.draining_started.v1. Publish from transactional outbox only. Consumers persist inbox uniqueness before applying effect in the same local transaction.

## Delivery and ordering
At-least-once delivery. Guarantee aggregate revision checks, not global ordering across all records. Handle out-of-order events by deferring/fetching authoritative state where required. Lease-based dispatch with heartbeat/recovery. Retry bounded errors; dead-letter malformed/permanent failures with owner. Replay retains original event ID. Consumer checkpoints survive restart. No business logic trusts a notification/email as a committed financial fact.

## External adapters
Expose ports for identity, payments, banking, tax, e-sign, carrier/maps, communications, storefronts, biometric devices, OCR and AI. Adapter manifest declares geography/currency/provider capability, credentials scopes, rate limits, timeout, webhook verification, dedupe, data residency and reconciliation method.

Webhooks verify signature/timestamp/replay window; preserve provider request ID. Unknown payment/filing outcome resolved by provider query/reference and reconciliation before another action. Scraping is optional only for permitted sources with documented access rights and brittle-field review; prefer contractual APIs/feeds.

## Compatibility
Version commands/events and support a declared window. Additive fields should preserve prior behavior; breaking money/state semantics require new contract version and migration. Native apps negotiate capability/readiness and supported API version. Removal only after deprecation and client deployment impact review.

## Test requirements
Schema contract; unauthorized field/scope; object enumeration; mass assignment; injection; cursor stability; duplicate and changed-payload keys; out-of-order events; worker restart; webhook tamper/replay; rate limit; unknown provider outcome; export authorization revoked after creation. Critical API tests run against actual PostgreSQL policies, not only mocked repositories.

