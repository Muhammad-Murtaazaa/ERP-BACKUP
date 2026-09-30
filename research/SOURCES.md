# Research sources and use
Checked 30 September 2026. Official sources support benchmarks and technical/regulatory design constraints. Requirements elsewhere are Omnysync's proposed design, not copied vendor specifications or certified parity.

| ID | Official source | Use / scope |
| --- | --- | --- |
| SRC-01 | [SAP product portfolio](https://www.sap.com/products.html) | Broad ERP, finance, HCM, supply-chain and platform categories |
| SRC-02 | [SAP ERP overview](https://www.sap.com/products/erp.html) | Integrated cross-functional ERP benchmark |
| SRC-03 | [Oracle Fusion documentation index](https://docs.oracle.com/en/cloud/saas/index.html) | Suite boundaries across ERP, SCM and HCM |
| SRC-04 | [Oracle ERP readiness](https://docs.oracle.com/en/cloud/saas/readiness/erp.html) | Ongoing financials, procurement, projects and risk release coverage |
| SRC-05 | [NetSuite manufacturing overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1506100009.html) | BOM, work orders and production workflow benchmark |
| SRC-06 | [NetSuite HR feature enablement](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1112110056.html) | HR feature/capability availability is not one undifferentiated switch |
| SRC-07 | [NetSuite workforce management](https://www.netsuite.com/portal/products/hcm/workforce-management.shtml) | Scheduling, time collection, wage calculations and mobile benchmark |
| SRC-08 | [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) | RLS default policy behavior and privileged-role bypass limitations |
| SRC-09 | [PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html) | Exact NUMERIC vs inexact floating-point; deliberate scale and input checks |
| SRC-10 | [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) | Serializable/locking strategy and complete transaction retries |
| SRC-11 | [WCAG 2.2 recommendation](https://www.w3.org/TR/WCAG22/) | AA target, contrast, keyboard/focus/reflow, target size and accessible interaction |
| SRC-12 | [OWASP ASVS](https://owasp.org/projects/asvs) | Pin and verify an appropriate security requirements baseline |
| SRC-13 | [FBR digital-invoicing FAQ](https://www.fbr.gov.pk/faqs/173967/173969) | Integration qualification; FAQ is subordinate to applicable law/rules |
| SRC-14 | [FBR technical documentation portal](https://www.fbr.gov.pk/technical-documentation-di/163085/173959) | Locate current technical integration material before adapter implementation |
| SRC-15 | [IRS Publication 15](https://www.irs.gov/publications/p15) | Federal employer-tax guidance; regional coverage needs separate validation |
| SRC-16 | [IRS Publication 15-T](https://www.irs.gov/publications/p15t) | Federal withholding-method reference for effective rule fixtures |
| SRC-17 | [Tauri capabilities](https://v2.tauri.app/security/capabilities/) | Explicit native capability boundaries |
| SRC-18 | [React Native security](https://reactnative.dev/docs/security) | Native secret/token storage and app-boundary considerations |

## Research limits
Benchmarks were reviewed at portfolio and selected feature-documentation level. This is not an exhaustive audit of every vendor product, edition, localization, add-on or current release. No source supports a claim that the proposed platform already matches them. SAP dynamically rendered detailed area pages were not used for exact feature claims; the accessible portfolio/ERP overview supports broad categories. Framework/runtime selections beyond the reviewed constraints remain ADR candidates.

FBR portal links identify documentation; implementing engineers must fetch and version the current detailed API specification and sandbox cases. IRS references do not establish every state/local payroll requirement. No tax rates, dates of liability, legal interpretations or production compliance are certified by this research.

Recheck sources at implementation and on effective rule/version changes. Record retrieved documents, versions and fixtures in the country/integration coverage registry. Never replace specialist approval with a search snippet.

