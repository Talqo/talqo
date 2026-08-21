# 0010: Use Orval for web API generation

## Status

Accepted (2026-08-20)

## Context

The dashboard needs typed fetch behavior, TanStack Query integration, and Zod wire schemas from the API-owned OpenAPI contract. Handwritten requests duplicate contracts, while a universal generated package would couple non-React SDK consumers to dashboard dependencies. Orval generates consumer-specific clients and preserves OpenAPI as the language-neutral boundary.

## Decision

Generate the dashboard API client from committed OpenAPI with Orval, using its React Query fetch client and Zod schemas under `apps/web`.

## Consequences

Dashboard request functions, hooks, keys, and types stay synchronized with the API. Generated output is committed and freshness-checked in CI. The generated client does not validate responses at runtime; validation lives at owned boundaries such as forms, and contract drift is covered by integration and E2E tests. Application code still owns cache policy, invalidation decisions, form extensions, and error presentation.
