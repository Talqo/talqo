# 0003: Adopt Single-Tenant RBAC

## Status

Accepted (2026-07-24)

## Context

ADR 0002 modeled `ACCOUNT` as a tenant so multiple organizations could share one deployment. Talqo is confirmed single-tenant: one deployment serves one organization, so a tenant boundary adds a join and a scoping check to every write path for no product benefit.

## Decision

Remove `ACCOUNT` and `ACCOUNT_MEMBER`. Rename the `account` module to `roles`, owning `USER_ROLE` (a direct user-to-role assignment) and `INVITATION` (invites a user into the app, not into an account). Entities that were account-scoped (`AGENT`, `AI_PROVIDER_CONFIG`, `MCP_CONFIG`, `USAGE_RECORD`, the activity log renamed `AUDIT_LOG`) drop that scoping; `AI_PROVIDER_CONFIG` and `MCP_CONFIG` become single app-wide config rows.

## Consequences

Write paths resolve a role, not a tenant plus a role — one less join everywhere. Reintroducing multi-tenancy later means redoing this and ADR 0002's work from scratch.
