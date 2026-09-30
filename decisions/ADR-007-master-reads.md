# ADR-007 — Master-data reads are open to authenticated users of the organization
Status: accepted • 1 October 2026

## Decision
Any authenticated member of the organization may read parties, items, the chart of accounts and fiscal periods, because pickers in every module need them. Writes stay permission-gated; warehouse and stock reads keep the inventory read permission. Reads are always scoped to the organization. Employee, payroll and bank-statement data are not master data and keep their module permissions.
