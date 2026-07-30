# 0004: Use Drizzle for Relational Persistence

## Status

Accepted (2026-07-18)

## Context

Talqo needs type-safe relational access while keeping SQL behavior and schema ownership explicit. Raw SQL offers maximum control but duplicates result and input typing. Heavier ORMs and data mappers centralize models, hide SQL behavior, and add lifecycle machinery. Drizzle preserves SQL-like queries and module-owned schemas while deriving TypeScript types.

## Decision

Use Drizzle for typed relational access, keep schema declarations with their owning modules, and generate migrations centrally.

## Consequences

Queries and schemas remain type-safe, inspectable, and close to their domains while migrations follow one application-wide workflow. Persistence code depends on Drizzle conventions, cross-module schema changes require coordination, and domain rules must remain outside ORM declarations and models.
