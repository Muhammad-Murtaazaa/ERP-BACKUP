# ADR-011 — Internal automation: deterministic rules and autonomy tiers
Status: accepted • 1 October 2026

## Decision
Automation is in-process and deterministic. It uses no external AI or network providers. Each rule has a tier:
- **A0** reads and alerts only: reorder, stock vs GL, dunning, AP due, depreciation due, period close, approval aging, POS monitor.
- **A2** is a bounded, reversible, non-financial change: bank auto-match, which is on by default and only links unique exact matches (sign-off stays manual), and PM work-order creation.
- **A3** is policy-bound posting: recurring journals post only after maker-checker approval, within the approved amount, through `postJournal` with an idempotent sourceKey, and only into open periods.
- **A4** is never automated. This covers releasing payments, approvals, period close and write-offs.

The scheduler ticks every 60 s. Occurrences are unique per rule and schedule slot, so several API instances can run it safely. Failures retry the same occurrence with backoff of 1, 2, 4… minutes, capped at 60. After `max_attempts` the run is dead-lettered and a CRITICAL alert goes to the owner role. Each rule has a pause switch.

## Consequences
The rules behave like cron jobs. There is no visual rule builder or event trigger yet (AUT-001, AUT-003 planned). There is no email or SMS delivery; alerts appear in the in-app inbox.
