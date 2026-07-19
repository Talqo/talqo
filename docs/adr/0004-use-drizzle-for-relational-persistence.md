# 0004: Use Drizzle for Relational Persistence

## Status

Accepted (2026-07-18)

## Context

Relational persistence needs type-safe access while preserving explicit SQL-oriented schemas and module ownership. Raw SQL offers maximum control but more manual typing; a heavier ORM or data mapper adds abstraction and lifecycle machinery.

## Decision

Use Drizzle for typed relational access, keep schema declarations with their owning modules, and generate migrations centrally.

## Consequences

Queries and schemas remain type-safe, inspectable, and close to their domains while migrations follow one application-wide workflow. Persistence code depends on Drizzle conventions, cross-module schema changes require coordination, and domain rules must remain outside ORM declarations and models.
