# 0003: Use PostgreSQL

## Status

Accepted (2026-07-18)

## Context

Talqo requires ACID transactions, relational constraints, concurrent writes, JSON support, and server-grade operations. PostgreSQL provides these with mature self-hosted and managed options plus direct Drizzle and driver support. SQLite has a different concurrency and deployment model; MySQL and MariaDB are viable but introduce different SQL, migration, and operational behavior without a current benefit.

## Decision

Use PostgreSQL as the authoritative relational datastore.

## Consequences

Talqo gains a mature database with strong transactional and relational capabilities and broad tooling. Operations, schema migrations, queries, and supported environments become coupled to PostgreSQL-specific behavior.
