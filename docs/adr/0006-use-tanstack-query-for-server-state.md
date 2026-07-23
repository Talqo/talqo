# 0006: Use TanStack Query for Server State

## Status

Accepted (2026-07-18)

## Context

The React app consumes an OpenAPI REST client and needs shared caching, request deduplication, mutations, and invalidation across routes. TanStack Query integrates with TanStack Router without requiring Redux or GraphQL. Router-only loading underserves non-navigation updates; Apollo targets GraphQL, RTK Query requires Redux, and ad hoc React state duplicates server-state lifecycle logic.

## Decision

Use TanStack Query to own derived browser server state, request lifecycles, caching, and invalidation while PostgreSQL and the API remain authoritative.

## Consequences

Components share consistent loading, error, deduplication, refresh, and invalidation behavior. Query keys and invalidation rules become application conventions that require discipline, and cached browser data remains temporary rather than a source of truth.
