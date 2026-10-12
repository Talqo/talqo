# 0019: Grant permissions through roles

## Status

Accepted (2026-10-12)

## Context

Operators need named roles holding several permissions, with several roles per account. Keeping per-user grants beside roles means access can come from a source the dashboard can neither show nor revoke. Turning the single admin into a system role instead would need a data migration and a system-role special case in every role route, for one read-only row.

## Decision

Roles are the only way to give non-admin permissions; the admin stays a direct grant, the only grant the database accepts.

## Consequences

One mechanism to show and revoke in the dashboard, and setup, seed and the one-admin index stay unchanged. Roles can never hold `admin`. Migration `0010` deletes existing non-admin grants, so deployments that used the removed `/permission-grants` API must recreate that access as roles.
