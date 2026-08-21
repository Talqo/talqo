# 0010: Use Orval for web API generation

## Status

Accepted (2026-08-20)

## Context

The dashboard needs typed fetch behavior, TanStack Query integration, and Zod wire schemas from the API-owned OpenAPI contract. Handwritten requests duplicate contracts, while a universal generated package would couple non-React SDK consumers to dashboard dependencies. Orval generates consumer-specific clients and preserves OpenAPI as the language-neutral boundary. Orval's fetch runtime validation was rejected: at 8.24 its generator emits type-only imports for schemas it calls as values, producing broken code that would require a permanent output patch.

## Decision

Generate the dashboard API client from committed OpenAPI with pinned Orval, using its React Query fetch client and Zod schemas under `apps/web`.

## Consequences

Dashboard request functions, hooks, keys, and types stay synchronized with the API. Generated output and the OpenAPI document are committed and verified with regenerate-and-diff freshness checks. Validation lives at owned boundaries: forms parse with the generated Zod schemas and drift is caught by integration and E2E tests, not by client runtime validation.
