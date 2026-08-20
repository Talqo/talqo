# 0011: Serve Widget Configuration From A Public Token Endpoint

## Status

Accepted (2026-08-19)

## Context

Embedded widgets need their appearance at boot, and FR-3.5 requires the SDK to read the same configuration. Inlining settings into the embed snippet goes stale the moment an operator changes a color, forcing every customer to re-paste it. Serving it instead needs an unauthenticated endpoint reachable from arbitrary customer origins.

## Decision

Serve widget appearance from an unauthenticated `GET /api/widget-config/:token`, identified by a plaintext public token, with wildcard CORS scoped to that path and ordered ahead of the auth middleware.

## Consequences

Appearance changes reach live sites within the sixty-second cache without touching customer HTML; precedence becomes defaults < fetched config < `data-talqo-*` attributes. The token is stored unhashed, unlike invitation tokens, because it identifies rather than authenticates. The path sits outside `/api/widgets` so an exemption mistake cannot expose authenticated CRUD; a route test asserts that boundary.
