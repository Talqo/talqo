# 0003: Use PostgreSQL

## Status

Accepted (2026-07-18)

## Context

Talqo requires relational integrity, transactions, expressive queries, and dependable operational tooling for authoritative application data. Document databases and embedded relational databases provide different scaling or deployment trade-offs but fit these requirements less directly.

## Decision

Use PostgreSQL as the authoritative relational datastore.

## Consequences

Talqo gains a mature database with strong transactional and relational capabilities and broad tooling. Operations, schema migrations, queries, and supported environments become coupled to PostgreSQL-specific behavior.
