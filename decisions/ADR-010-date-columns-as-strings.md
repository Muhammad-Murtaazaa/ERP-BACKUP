# ADR-010 — SQL DATE values are returned as YYYY-MM-DD strings
Status: accepted • 1 October 2026

## Context
PGlite parsed `DATE` into JavaScript `Date` objects set to midnight UTC. The API then serialised them as `2026-03-01T00:00:00.000Z`, and that string appeared in the UI. Formatting those values in local time could also show the previous day in time zones west of UTC.

## Decision
The driver registers a parser for type oid 1082 that returns the raw `YYYY-MM-DD` string. Timestamps (`TIMESTAMPTZ`) are unchanged. The full test suite passes with this change (API tests compare dates as strings).
