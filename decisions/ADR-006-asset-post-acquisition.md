# ADR-006 — Asset registration can post acquisition when asked
Status: accepted • 1 October 2026

## Decision
Registering an asset does not post to the GL by default, because most assets arrive through AP bills that are already posted. Setting `post_acquisition: true` posts Dr Fixed Asset Cost and Cr the chosen funding account through `postJournal`, with idempotent sourceKey `ASSET_ACQUISITION:<id>`. Depreciation uses sourceKey `DEPRECIATION:<asset>:<period>`, so a period cannot be charged twice. `controls.test.ts` covers this, including concurrent attempts.
