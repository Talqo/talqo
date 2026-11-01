# 0021: Grant permissions through roles

## Status

Accepted (2026-10-12)

## Context

Combining roles with direct per-user grants leaves two mechanisms to inspect and revoke. A protected Admin role would unify permission storage, but require changes to bootstrap and exceptions to role management. Retaining the bootstrap admin grant preserves the existing ownership model.

## Decision

Roles are the only way to give non-admin permissions; the admin stays a direct grant, the only grant the database accepts.

## Consequences

Ordinary access has one management path. Admin access remains a separate, non-delegable privilege, and roles cannot hold `admin`. There are no deployed installations to migrate from direct grants.
