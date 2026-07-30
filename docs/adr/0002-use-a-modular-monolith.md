# 0002: Use a Modular Monolith

## Status

Accepted (2026-07-18)

## Context

Talqo needs strong domain ownership without distributed-system overhead. Technical-layer folders group code by implementation and weaken business boundaries. Package-per-domain adds build and export ceremony without deployment isolation. Independently deployed services add network failure, observability, consistency, and operational costs before Talqo needs independent scaling.

## Decision

Organize in-application domains as modules under `src/modules`, expose module capabilities through service-based APIs, and deploy the application centrally.

## Consequences

Domain behavior remains cohesive while deployment, testing, and operations stay simple. Module boundaries depend on conventions and require ongoing architectural enforcement; independently scaling or deploying one module requires a later architectural change.
