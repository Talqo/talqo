# 0009: Hand-Roll Authorization Checks

## Status

Superseded by ADR-0021 and ADR-0020 (2026-10-25)

## Context

The `roles` module must enforce per-user permission grants, checked on every mutating route. CASL (`@casl/ability`) is actively maintained and could express this, but its value is composable rules across multiple simultaneous conditions, subjects, and fields — more than a single-dimension grant model needs. A dependency's cost should match actual requirement complexity, not speculative future need.

## Decision

Enforce authorization with one hand-rolled `can(user, grants, permission)` function that every mutating route calls; no external authorization library.

## Consequences

Zero new dependency surface and a small, fully auditable enforcement path for the BOLA-sensitive check that matters most. Revisit if a future FR needs authorization to depend on two or more simultaneous resource-relationship dimensions at once — that is when CASL's composability starts paying for itself.

Amendment (2026-10-25): the principle stands — authorization remains hand-rolled, small, centralized, and framework-free — but the single `can` function grew into the `access.*` policy middleware in `src/http/access.ts` plus `roles.service.ts` authority functions (`requireAgentPermission`, `requireAgentScope`, `listEffectivePermissions`).
