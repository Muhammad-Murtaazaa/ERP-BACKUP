# ADR-013 — Event-triggered automation rules are limited to ALERT and TASK actions
Status: accepted • 1 October 2026

## Decision
Event rules subscribe to outbox events such as `CRM_OPPORTUNITY_WIN`, `SERVICE_CASE` and `GRC_CONTROL_FAILED`. They are built in the Workflow Studio visual builder:
- trigger, then conditions, then action;
- conditions use exact-decimal comparison, dates, and in/contains/exists;
- action templates are rendered.

The only actions allowed are an in-app **ALERT** or a **TASK**. Each event is delivered exactly once per rule, keyed by (rule, event id). A simulation mode evaluates conditions with no side effects.

Event rules cannot post journals, change records, release payments or send external messages. Tier A3/A4 actions stay with the scheduled, maker-checker paths in ADR-011.

## Consequences
- Tenants can automate notifications safely, and a misconfigured rule cannot move money or data.
- Richer actions, such as creating records or calling webhooks, need a new ADR. They would also need compensation and unknown-outcome handling (AUT-010/011).
