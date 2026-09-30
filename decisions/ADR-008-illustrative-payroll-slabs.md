# ADR-008 — Payroll tax slabs are illustrative configuration
Status: accepted • 1 October 2026

## Decision
The Pakistan salaried income-tax slabs and EOBI rates in the payroll engine are sample configuration for demos. They are not statutory advice. Production use requires a country pack that has been checked against the current Finance Act. A second REGULAR pay run for the same month is rejected (409 plus unique index `uq_payroll_regular_month`). Corrections use off-cycle runs.
