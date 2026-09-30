# ADR-005 — Quality rejection posts scrap directly from inventory
Status: accepted • 1 October 2026

## Decision
A rejected inspection lot writes defective quantity off through an NCR. The entries are Dr 511003 Manufacturing Scrap and Cr Inventory, with a matching negative stock movement. The quantity is not first moved to a separate quarantine warehouse. A quarantine or blocked-stock status is a planned enhancement (QLT backlog). Until it exists, a lot that is under inspection is not reserved.
