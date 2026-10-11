# 0019: Add roles beside direct grants

## Status

Accepted (2026-10-11)

## Context

Operators need named roles holding several permissions, with several roles per account. Replacing per-user grants with roles gives one mechanism, but needs a data migration and a system Admin role that every role route must special-case. Today the only grant real deployments hold is the admin's; other grants exist only through an admin-only API without dashboard UI.

## Decision

Add roles beside direct grants: a user's permissions are their grants plus their roles' permissions, and admin stays a grant.

## Consequences

No data migration, and setup, seed and the one-admin index stay unchanged. Roles can never hold `admin`. Until non-admin grants are removed, access can come from a grant the dashboard can neither show the source of nor revoke; a follow-up removes them and moves the tests to roles.
