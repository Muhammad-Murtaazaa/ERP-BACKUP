# PostgreSQL transaction specifications
These sequences describe required implementation semantics; they are not executable database code. Use reviewed migrations and prove behavior with real overlapping PostgreSQL transactions.

## Isolation policy
Default read committed is sufficient for simple noncontested operations only with appropriate locks. For complex cross-row invariant decisions, use serializable or a proven explicit locking strategy. Retry serialization/deadlock failures by rerunning the complete bounded idempotent transaction. See [PostgreSQL isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html).

Define one lock order: scope/entity guard -> fiscal period -> source aggregate -> ordered resource/open-item/account locks. Exact order is reviewed across modules to prevent opposing locks. Do not acquire locks while waiting for a human approval or external network call.

## TX-001: post commercial invoice
Begin; establish transaction-local organization context; validate membership/entity/permissions/capability; claim source idempotency key; lock invoice and period; assert expected revision, approval/hash, open period; resolve effective mapping/tax/FX snapshots; compute exact intent; insert immutable AR obligation and journal/lines through financial engine; validate base balance/leaf accounts/dimensions; set invoice accounting state; insert audit/outbox; persist command outcome; commit.
Failure before commit rolls back all authoritative effects. After commit, notification/statutory delivery is queued and has its own status. Invoice posting does not manufacture a shipment or recognize revenue outside its approved policy.

## TX-002: allocate receipt
Begin; scope/permissions/key; lock receipt and target open items in stable ID order; recompute unapplied/eligible outstanding; validate currency/allocation policy; insert allocations and required clearing/FX/reclassification journals; update projections; audit/outbox/outcome; commit.
AR obligation and GL are updated under their defined accounting purpose. Two receipts cannot both allocate the same remaining 100. An overpayment stays separately unapplied.

## TX-003: accepted purchase receipt
Begin; lock PO source lines and affected inventory resource rows in consistent order; recheck receipt revision/remaining quantities/UOM/quality disposition; insert movement and valued layer in valued mode; create inventory/GRNI purpose; update PO fulfillment projection; audit/outbox; commit.
Quarantined quantity may be physically on-hand but unavailable. Service acceptance uses its own quantity/cost evidence and creates no stock.

## TX-004: shipment
Begin; lock fulfillment source/reservations and selected stock layers/serials; revalidate picked quantities and transfer-of-control policy; insert issue facts; consume value layers; create COGS/inventory purpose if financially valued; update line entitlement; audit/outbox; commit.
Retry cannot consume again. Multiple base journals by source are distinguished by purpose, so invoice and shipment never collide or duplicate cost.

## TX-005: payment execution with external boundary
Transaction A: verify approvals/beneficiary/amount/revision and held obligations; freeze durable provider intent and idempotency/reference; reserve eligible payment entitlement; audit/outbox; commit.
Worker calls provider with stable key outside DB transaction.
Transaction B: verify webhook/query evidence and dedupe; lock intent/open items; mark confirmed/rejected/unknown; post settlement/clearing and allocations exactly once when eligible; audit/outbox; commit.
Unknown stays reserved or exception-handled under policy; query/reconcile before retry. Do not release reservation as failed merely because network timed out. A compensating refund is separately authorized.

## TX-006: period close
Begin; authorize and lock same period guard used by all postings; verify latest reconciliations and blocking tasks at current ledger watermark; assert no unfinished authoritative transaction can post past the guard; transition soft/hard_closed; record checks/reviewer/evidence; audit; commit.
Reopen uses same guard, reason and approval. Checklist cached before lock cannot replace final authoritative validation.

## TX-007: module draining
Begin; lock module capability state; validate dependent graph and required retained settlement/correction actions; block new root commands; mark draining with policy snapshot; emit event; commit.
Workers cancel new schedules and reconcile existing runs. Do not delete tables or rollback posted transactions. Complete transition after measured open-obligation blockers resolved.

## TX-008: production completion
Begin; scope/key; lock order, input/output entitlements, stock layers and period; validate frozen BOM/routing/quality/actual quantities; record unique component consumption/completion; create WIP/output facts and journal purposes; update order totals; audit/outbox; commit.
Backflush and actual issues must have disjoint accounted bases. Scrap and co-product allocation preserve cost.

## Schema invariants
Composite foreign keys containing organization scope; source-purpose unique key; revision and allowed-state checks; required dates/currency/mapping version; exact finite numeric bounds; parent/leaf/account-type rules; journal balance deferred constraint/routine; period guard; unique provider/inbox identities; immutable posted facts and controlled correction permissions. Financial balance spans rows and cannot be implemented by a naive per-line CHECK alone.

## Retry and recovery
Set transaction and lock timeouts; classify conflicts vs retryable failures; cap attempts/jitter; safe command result lookup for uncertain app response. Provider calls never repeated solely after an app timeout. Backfill/rebuild jobs are scope-limited and checkpointed; correcting projections never changes immutable facts.

