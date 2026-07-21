# 0002: Replace Admin Users With Account-Scoped RBAC

## Status

Accepted (2026-07-21)

## Context

The prototype modeled a single `CLIENT` per tenant plus a global `ADMIN_USER` with its own `ADMIN_ACCESS_LOG`, requiring a back-office app. We are cutting back-office and need multiple people to collaborate on one account, each with different permissions, without a separate superuser class or app.

## Decision

Split `CLIENT` into `ACCOUNT` (tenant/billing) and `USER` (login identity), join them through `ACCOUNT_MEMBER` carrying a `role`, and replace `ADMIN_ACCESS_LOG` with account-scoped `ACCOUNT_ACTIVITY_LOG` whose actor is always a normal `USER`.

## Consequences

Any number of users can join an account with a scoped role, and there is no global admin surface or back-office app to build or secure. Every write path that previously assumed one client per session must now resolve the acting account and role. Self-registration becomes an `INVITATION` flow instead of open sign-up.
