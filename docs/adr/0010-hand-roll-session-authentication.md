# 0010: Hand-Roll Session Authentication

## Status

Accepted (2026-08-05)

## Context

ADR-0008 chose Better Auth for `identity`'s session mechanics. Implementing it surfaced two concrete problems. First, self-registration must be force-disabled (TASK-003 is invite-only), and Better Auth's `admin` plugin — its supported path for user/password management — bakes a role/ban model onto `user`, conflicting with identity's "zero knowledge of roles" boundary; without the plugin, the account-creation and admin-reset methods identity needs would have to call Better Auth's internal, undocumented primitives (`internalAdapter`, `runWithTransaction`) instead of its public API. Second, Better Auth owns its own request/response shapes via a self-contained handler, which doesn't fit this repo's `contract.ts` → OpenAPI → generated-client convention without a permanent carve-out.

## Decision

Hand-roll session authentication in `identity`: `Bun.password` (argon2id) for hashing, an opaque high-entropy session token (DB stores only its SHA-256 hash) in a `SESSION` table, `hono/cookie` for cookie handling.

## Consequences

`identity` fits the repo's `contract.ts`/OpenAPI convention natively, with no new dependency and no signing secret (opaque token + DB lookup, not a stateless/signed session). Talqo now owns CSRF protection, cookie hardening, and session-rotation correctness directly instead of a maintained library. Building SSO later (FR-2.3a, deferred) means implementing OAuth from scratch rather than enabling a plugin.
