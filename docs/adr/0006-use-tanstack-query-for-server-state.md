# 0006: Use TanStack Query for Server State

## Status

Accepted (2026-07-18)

## Context

Browser code needs consistent request lifecycles, caching, invalidation, and derived views of remote data. Router-only loading centralizes navigation fetches but poorly serves interactive refreshes; ad hoc React state duplicates lifecycle and cache logic.

## Decision

Use TanStack Query to own derived browser server state, request lifecycles, caching, and invalidation while PostgreSQL and the API remain authoritative.

## Consequences

Components share consistent loading, error, deduplication, refresh, and invalidation behavior. Query keys and invalidation rules become application conventions that require discipline, and cached browser data remains temporary rather than a source of truth.
