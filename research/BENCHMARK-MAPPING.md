# Enterprise benchmark mapping
This table maps broad benchmark domains to proposed Omnysync coverage. It is a planning comparison, not exact feature equivalence.

| Benchmark area | Reference | Proposed modules/specifications | Verification still required |
| --- | --- | --- | --- |
| Enterprise financials | Oracle suite/readiness; SAP portfolio | GL, AR, AP, TRY, EPM, TAX | Book policy, scale, country coverage and reconciliations |
| Procurement and supplier lifecycle | Oracle readiness; SAP portfolio | PUR, SUP, AP, INV | Sourcing/match exceptions and end-to-end transactions |
| Manufacturing and supply chain | NetSuite manufacturing; SAP ERP | MFG, QLT, INV, WMS, LOG | BOM revisions, planning/cost accuracy and traceability |
| HR and workforce | NetSuite HR/WFM; Oracle suite | HR, TAL, TIM, PAY | Sensitive access and regional payroll/labor scope |
| Projects and service | Oracle readiness; SAP ERP portfolio | PRJ, SRV, AST | BOQ/contract/revenue treatment and field execution |
| Configurability/platform | Enterprise suite categories | PLT, CFG, AUT, BI, DOC, GRC | SDK compatibility, authorization and resilient workflows |
| Omnysync delivery model | User-specific requirements | ADM, ownership/deployment/native specifications | Independent-client handover, domains and demo safety |
| Specialized industries | User ambition and original pack design | INDUSTRY-PACKS.md, FLT, LND | Separate fit-gap/regulatory/operational qualification |

Sources and access scope are listed in [SOURCES.md](SOURCES.md). Do not label a module SAP-equivalent or NetSuite-equivalent because its name appears here.

## Future parity evaluation
For each target client/vendor edition: identify exact benchmark workflow, official feature documentation/version, local geography, data volumes, mandatory controls, configuration dependencies and observable acceptance. Mark Omnysync covered/partial/missing/provider-required with implementation/test evidence. Add requirements without renumbering existing ones. Evaluate the real process and exceptions, not screenshots.

