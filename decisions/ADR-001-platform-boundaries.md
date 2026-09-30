# ADR-001 — Independent client installations and modular core
Status: proposed baseline • 30 September 2026

## Context
Omnysync wants one reusable module library plus quick demos. Clients require ownership, their own VPS or local deployment, and connected desktop/mobile apps. Enterprise finance needs reliable transactions; small installations need manageable operating complexity.

## Decision
Build a modular TypeScript monolith on PostgreSQL with one financial engine and explicit module contracts. Production defaults to an independent client installation. Omnysync runs a separate control plane for demo/release management; client runtime has no mandatory dependency on it. UI/native clients call the same authoritative command API. Country and industry packs are versioned.

## Alternatives considered
Shared-only SaaS conflicts with the requested ownership/control profile. Separate bespoke forks repeat development and break reusable upgrades. Microservices from launch complicate accounting consistency, recovery and VPS operations. Extending another ERP was offered; user selected own platform.

## Consequences
We operate/support multiple deployment versions and need signed releases, portability, qualified sizing and upgrade tooling. Client ownership/IP must be explicit contractually. Use additional services only when measured need and operational capacity justify them. No implicit central production superuser.

## Revisit
Measured scale/availability requires isolation/extraction; commercial model changes by explicit agreement; device support changes native stack; localization/integration scope requires a qualified provider.

