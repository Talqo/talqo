# 0009: Hand-Roll Authorization Checks

## Status

Accepted (2026-08-06)

## Context

The `roles` module must enforce per-user, per-permission grants optionally scoped to a single agent (SRS §2.3), checked on every mutating route. CASL (`@casl/ability`) is actively maintained and could express this, but its value is composable rules across multiple simultaneous conditions, subjects, and fields — more than a single-dimension grant model needs. A dependency's cost should match actual requirement complexity, not speculative future need.

## Decision

Enforce authorization with one hand-rolled `can(user, grants, permission, agentId?)` function that every mutating route calls; no external authorization library.

## Consequences

Zero new dependency surface and a small, fully auditable enforcement path for the BOLA-sensitive check that matters most. Revisit if a future FR needs authorization to depend on two or more simultaneous resource-relationship dimensions at once — that is when CASL's composability starts paying for itself.
