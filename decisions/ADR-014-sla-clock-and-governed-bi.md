# ADR-014 — Fixed-offset SLA business clock, and governed BI datasets
Status: accepted • 1 October 2026

## Decision
**SLA clock:**
- Field-service SLAs run only inside the configured business hours (`service.business_hours`, default Mon–Sat 09:00–18:00) and skip holidays.
- Times are computed in Asia/Karachi using a fixed +05:00 offset. Pakistan has no DST, so this is exact for current tenants.
- A tenant in a DST zone needs a tz-database implementation first.

**BI:**
- BI reads from 8 datasets declared in code. Each dataset declares its columns and measures, and has a required permission.
- Widgets reference a dataset and measure, and are validated server-side.
- Widgets the viewer may not read are hidden.
- CSV exports neutralise spreadsheet formulas.
- There is no free-form SQL and no drag-and-drop builder.

## Consequences
- Results are predictable and permission-safe. The revenue dataset is tested to reconcile to the ledger.
- Adding a dataset requires a code change and review.
