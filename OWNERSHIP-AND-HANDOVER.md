# Client ownership and handover
Confirmed requirement: the client owns and can operate its delivered system. Specify contractual rights precisely before selling a deployment. This is a requirements checklist for legal/commercial review, not contract language.

## Ownership dimensions
| Dimension | Required baseline | Decision/evidence |
| --- | --- | --- |
| Client data/files | Client ownership and complete portable export | Data inventory and tested export |
| Infrastructure | Client-controlled VPS/cloud/LAN accounts where chosen | Client billing/admin control |
| Domain/DNS | Client control or portable licensed binding | Registrar/DNS credentials and transfer process |
| Secrets/provider accounts | Client control, narrowly delegated support | Credential inventory and rotation |
| Operational independence | Works without Omnysync console/telemetry | Disconnected operation test |
| Delivered source/build | Client receives agreed source/build material and modification/operation rights | Signed contract plus reproducible build |
| Client customization IP | Expressly defined ownership/license and dependency rights | Extension source and license inventory |
| Reusable Omnysync core IP | Needs explicit decision: exclusive assignment, nonexclusive ownership/license model, or other agreed arrangement | Open decision; no unstated assumption |
| Third-party components | Rights constrained by their own licenses | SBOM, notices and review |
| Support/updates | Optional service with independent operation after exit | SLA/release support policy |

Operational ownership is specified here. Whether every client receives exclusive copyright over the same reusable core cannot be inferred; exclusive transfer may conflict with reuse unless the commercial arrangement grants continuing rights. Resolve this explicitly rather than hiding it in architecture. User requirement takes priority over generic SaaS licensing assumptions.

## No lock-in requirements
No mandatory remote phone-home for ordinary transactions. No central switch disables access to legal financial/HR history. No hidden Omnysync master user. Data export includes schema, entity relationships, decimal values, currencies, source IDs, rule/mapping versions and attachments. Client can replace operator or provider. Contract-approved activation/licensing must include independent/offline verification and agreed continuing operating rights.

## Handover package
Release source or agreed access with dependencies and lockfiles; reproducible build instructions; signed runtime artifacts; module/country/extension manifest; SBOM/notices; schema/migration history; architecture and operating docs; configuration export; separately transferred secrets; domain/TLS/identity ownership; backup/restore evidence; monitoring/runbooks; client user/security admin training; dataset/export/restore scripts; known gaps and supported versions; acceptance evidence.

## Acceptance demonstration
Client or appointed engineer builds and deploys on a clean host, restores complete data/files/identity/config, reconciles financial/stock totals, changes keys/admin access, disconnects Omnysync services, performs invoice/receipt/stock task, exports all agreed data and revokes support access. Document dependencies that legitimately need internet/provider accounts, such as bank/tax gateways.

## Native app ownership
Define app-store publisher, signing certificates, distribution method, source access and maintenance rights. A client-controlled endpoint is configurable through secure onboarding; mobile/desktop are not tied permanently to an Omnysync SaaS URL. Installer/update signing and endpoint trust survive support termination under the agreed handover.

