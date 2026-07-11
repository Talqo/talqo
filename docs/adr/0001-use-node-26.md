# 0001: Use Node 26

## Status

Accepted (2026-07-11)

## Context

Talqo needs a widely supported runtime for contributors, CI, observability, and self-hosting. Node has broader ecosystem compatibility than Bun. Node 26 is not LTS until October 2026, but we accept the early-adoption risk instead of starting on Node 24 LTS.

## Decision

Use Node.js 26 as the sole supported JavaScript runtime.

## Consequences

We gain current Node features and broad ecosystem support. Until Node 26 enters LTS, we must track releases closely and may encounter current-line regressions.
