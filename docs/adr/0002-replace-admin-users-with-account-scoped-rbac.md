# 0002: Replace Admin Users With Account-Scoped RBAC

## Status

Superseded by ADR-0003 (2026-07-24)

## Context

Multiple people need to collaborate on one account, each with different permissions, without a separate superuser class or a back-office app to build and secure. Self-registration must not be open sign-up.

## Decision

Separate `ACCOUNT` (tenant) from `USER` (login identity), join them through `ACCOUNT_MEMBER` carrying a `role`, and record account-scoped activity in `ACCOUNT_ACTIVITY_LOG` whose actor is always a normal `USER`. Members join an account through an `INVITATION`: a shareable link/code, not an emailed token.

## Consequences

Any number of users can join an account with a scoped role, and there is no global admin surface or back-office app to build or secure. Every write path must resolve the acting account and role. Self-registration is invite-only.
