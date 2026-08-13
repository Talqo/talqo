# 0008: Use Better Auth for Session Authentication

## Status

Superseded by ADR-0010 (2026-08-05)

## Context

The `identity` module needs session-based login (FR-2.3) and must reject unauthenticated requests (NFR-3.2). Hand-rolled sessions require getting cookie flags, session fixation, rotation, and CSRF protection right — easy to get subtly wrong. Better Auth ships DB-backed sessions with an official Drizzle adapter and direct Postgres/Hono support, fitting the stack already fixed by ADR-0001, ADR-0003, and ADR-0004. It is MIT-licensed and actively maintained (~28k GitHub stars, 7k+ commits).

## Decision

Use Better Auth for the `identity` module's login/session mechanics, backed by Postgres via its Drizzle adapter, using its default password hashing (scrypt).

## Consequences

Session correctness (fixation, rotation, cookie flags, CSRF) is handled by a maintained library instead of hand-rolled code. `identity` takes on Better Auth as a dependency and must track its releases and security advisories. Password hashing is scrypt, not Bun's native argon2id, unless explicitly overridden later.
