# Documents, approvals and internal collaboration

**Module ID:** documents-collaboration  
**Prefix:** DOC  
**Readiness:** planned; scope-specific verification required  
**Hard dependencies:** [platform](platform.md)

## Workflow and entities
Capture -> classify -> collaborate/review -> issue/sign -> retain.
Owned entities: File, template/version, document, comment, task, approval reference, signature, hold. Separate operators, process owners, approvers, administrators and auditors; portal users access only their authorized party records.

## Controls
Authorized recipients and file access rechecked; documents may be legally retained after source workflow ends.
All rows inherit [MODULE-CONTRACT.md](../MODULE-CONTRACT.md), [SECURITY.md](../SECURITY.md), [logic.md](../logic.md) and relevant financial/localization rules.

## Feature requirements
| ID | Feature | Required behavior | Minimum domain acceptance |
| --- | --- | --- | --- |
| DOC-001 | Attachments | Scan/type/size/quarantine uploads | Unsafe file not downloadable |
| DOC-002 | Versioned documents | Retain source/version/effective status | Issued content retrievable |
| DOC-003 | Folders/tags | Organize scoped documents | Tag not grant access |
| DOC-004 | Comments | Link authorized record discussion | Unauthorized recipient excluded |
| DOC-005 | Mentions | Resolve identity and source permission | No protected content sent to wrong person |
| DOC-006 | Tasks | Assign dates/dependencies/source | Completed source not create duplicate task |
| DOC-007 | Review routing | Use approval engine and version hash | Changed document reapproval |
| DOC-008 | Signatures | Integrate qualified provider evidence | Signed revision immutable |
| DOC-009 | Templates | Sandbox deterministic rendering | Template cannot execute arbitrary code |
| DOC-010 | Generated PDFs | Record source/template/data snapshot | Output reproducible |
| DOC-011 | Search | Index authorized safe metadata/content | Sensitive content excluded by policy |
| DOC-012 | Sharing | Expire/revoke approved scoped links | Revoked link fails |
| DOC-013 | Access logs | Record downloads/shares minimally | Audit cannot be altered by viewer |
| DOC-014 | Retention | Apply class/jurisdiction/hold | Hold blocks purge |
| DOC-015 | Archiving | Preserve linked source evidence | Module disable not erase issued document |
| DOC-016 | Notifications | Deliver channel-safe previews | Sensitive fields not in push text |
| DOC-017 | Print queues | Track device/job/retry | Retry not duplicate transaction |
| DOC-018 | Export package | Bundle authorized documents/metadata | Manifest complete without secrets |

## UI, reports and automation
Use scoped task workspace/list/detail/editor, accessible approval or execution panel, timeline, settings, authorized imports/exports and contextual help. [design-system.md](../design-system.md) and [UX-SCREEN-SPECS.md](../UX-SCREEN-SPECS.md) define shared behavior. [REPORTING.md](../REPORTING.md) governs metric definitions, date/currency basis and drill-through. Events use committed outbox facts; actions run scoped identities and durable intents under [AUTOMATION-AND-AI.md](../AUTOMATION-AND-AI.md). Optional adapters have explicit qualification and failure handling.

## Tests and lifecycle
Domain cases: Malware; unsafe template; external share; deleted source with legal hold.
Also verify field/scope denial, duplicate event/command, stale revision, unavailable dependency, worker crash, conflicting effective date and retention. Schema/API detail is expanded during the chosen slice. Enable requires compatible dependencies/configuration/coverage. Disable drains outstanding work while retaining legal history and authorized correction/settlement. Specialized regulated capabilities remain unavailable until their separate gate passes.

