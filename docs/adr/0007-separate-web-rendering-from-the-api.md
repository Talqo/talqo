# 0007: Separate Web Rendering from the API

## Status

Accepted (2026-07-22)

## Context

The dashboard, embedded widget, SDK, and integrations are first-class consumers of one API. A full-stack SSR app could expose that API but would couple dashboard rendering and releases to the public integration boundary. SSR plus a standalone API keeps the boundary but adds another server layer. The authenticated dashboard has no current SEO or server-rendering requirement.

## Decision

Keep `apps/api` as the standalone OpenAPI service and `apps/web` as a client-rendered consumer; deployment may package them together.

## Consequences

All clients share one contract, and web rendering can evolve without moving the API boundary. The dashboard handles client startup and browser API concerns. SSR can be added later without replacing the standalone API.
