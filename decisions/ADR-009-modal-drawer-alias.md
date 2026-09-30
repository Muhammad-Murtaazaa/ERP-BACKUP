# ADR-009 — Drawer replaces Modal; Modal kept as a deprecated alias
Status: accepted • 1 October 2026

## Decision
Every create and edit flow uses the right-side `Drawer`, following the Workman pattern. `Modal` is exported as an alias of `Drawer`, so a missed import still renders the correct pattern. New code must import `Drawer`. Removing the alias will be tracked in a follow-up.
