# 0002: Use a Modular Monolith

## Status

Accepted (2026-07-18)

## Context

Talqo needs strong domain boundaries without the operational cost of distributed systems. Credible alternatives are technical-layer folders, separate packages for each domain, and independently deployed services.

## Decision

Organize in-application domains as modules under `src/modules`, expose module capabilities through service-based APIs, and deploy the application centrally.

## Consequences

Domain behavior remains cohesive while deployment, testing, and operations stay simple. Module boundaries depend on conventions and require ongoing architectural enforcement; independently scaling or deploying one module requires a later architectural change.
