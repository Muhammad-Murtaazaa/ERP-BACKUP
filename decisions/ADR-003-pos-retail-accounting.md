# ADR-003 — POS retail accounting and cashier controls
Status: accepted • 1 October 2026

## Decision
- **Tender clearing:** a sale posts debits to 111004 cash clearing, 111005 card and wallet clearing, 211007 gift card and store credit, and 211008 loyalty (for redemptions). It also posts Dr 411004 discounts and promotions, Cr item sales accounts (gross) and Cr 212001 output tax. All of this happens in the same unit of work as the stock deduction. COGS and inventory post at the item's unit cost (ADR-002).
- **Loyalty:** the value of points earned is deferred (Dr 411004 / Cr 211008 loyalty liability), in the style of IFRS 15. Redemptions release the liability as a tender. Breakage is not recognised automatically.
- **Cash rounding:** cash totals round to the smallest denomination the drawer can pay. The difference posts to 911002 "Cash rounding". It is never absorbed into sales.
- **Manager self-authorisation:** a user who holds POS_REGISTER_MANAGE and is running their own till does not need a PIN approval. Their permission is the authority, and the action is recorded in the POS audit trail as self-authorised. This is a deliberate small-store exception to SoD. A manager cannot use their own PIN to approve a request they raised themselves; that returns 403 SEGREGATION_OF_DUTIES, tested in pos.test.ts. PINs lock out after repeated wrong attempts. A per-register switch to forbid manager self-authorisation is a follow-up.
- **Receipted returns:** a return against a receipt, refunded pro-rata to the original tender, needs no manager approval. A return without a receipt needs a manager PIN.
- **Client event journaling:** line voids, cart voids, scan misses, price checks and quantity changes happen before a sale exists. The terminal posts them to `/api/pos/sessions/:id/events` so shrink analysis has the data. The server accepts only a fixed list of event types.
- **Offline:** carts and sales are queued locally with a unique `client_ref`, and the server dedupes on it. Price, tax and promotion math runs in the same `priceCart` code on the client and the server, so totals match.
