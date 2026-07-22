# 0005: Use OpenAPI for API Contracts

## Status

Accepted (2026-07-18)

## Context

Talqo needs one contract for web, external, and non-TypeScript consumers. A handwritten OpenAPI specification duplicates route definitions and can drift from runtime validation. TypeScript RPC or inferred server types reduce duplication but couple every consumer to the repository's language and tooling. Generated OpenAPI preserves runtime-defined contracts while supporting standard client and documentation tooling.

## Decision

Generate OpenAPI from validated API contracts and use it as the language-neutral boundary for API consumers.

## Consequences

Consumers can generate clients and documentation from one portable contract without duplicating API definitions. Contract generation must remain in CI and release workflows; stale generated specifications or clients can misrepresent deployed behavior and require explicit regeneration checks.
