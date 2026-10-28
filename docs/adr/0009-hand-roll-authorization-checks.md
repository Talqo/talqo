# 0009: Hand-Roll Authorization Checks

## Status

Accepted (2026-08-06)

## Context

The platform must enforce per-user and per-agent permission grants on every route. CASL (`@casl/ability`) is actively maintained and could express this, but its value is composable rules across multiple simultaneous conditions, subjects, and fields — more than this grant model needs. A dependency's cost should match actual requirement complexity, not speculative future need.

## Decision

Enforce authorization with hand-rolled checks; no external authorization library. Routes declare their access policy through `access.*` helpers, and the `roles` service evaluates authority (`requireAgentPermission`, `requireAgentScope`, `listEffectivePermissions`).

## Consequences

Zero new dependency surface and a small, fully auditable enforcement path for the BOLA-sensitive checks that matter most. Revisit if a future FR needs authorization to depend on two or more simultaneous resource-relationship dimensions at once — that is when CASL's composability starts paying for itself.
