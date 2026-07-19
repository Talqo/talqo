# 0005: Use OpenAPI for API Contracts

## Status

Accepted (2026-07-18)

## Context

API consumers need a language-neutral contract that reflects runtime validation. A handwritten OpenAPI specification can drift from implementation, while TypeScript-only RPC couples consumers to one language and toolchain.

## Decision

Generate OpenAPI from validated API contracts and use it as the language-neutral boundary for API consumers.

## Consequences

Consumers can generate clients and documentation from one portable contract without duplicating API definitions. Contract generation must remain in CI and release workflows; stale generated specifications or clients can misrepresent deployed behavior and require explicit regeneration checks.
