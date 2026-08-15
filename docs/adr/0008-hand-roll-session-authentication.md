# 0008: Hand-Roll Session Authentication

## Status

Accepted (2026-08-05)

## Context

The `identity` module needs invite-only account creation, password administration, and session login without owning roles. Better Auth was considered, but its supported administration plugin adds a conflicting role model; avoiding that plugin requires undocumented internal APIs. A small first-party implementation fits the existing module boundary but makes Talqo responsible for session security.

## Decision

Hand-roll session authentication in `identity` using `Bun.password` with argon2id, opaque high-entropy tokens whose SHA-256 hashes are stored in PostgreSQL, and hardened cookies through `hono/cookie`.

## Consequences

The identity boundary stays small and dependency-free, with no signing secret because sessions use server-side token lookup. Talqo must maintain CSRF protection, cookie hardening, session rotation, and expiry cleanup. Adding SSO later requires separate OAuth support.
