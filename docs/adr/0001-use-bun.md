# 0001: Use Bun

## Status

Accepted (2026-07-16)

## Context

Talqo needs a fast TypeScript toolchain with minimal operational and contributor overhead. Node.js with pnpm and separate runtime, test, and build tools offers broader compatibility, but requires more tools and configuration.

## Decision

Use Bun as the sole supported runtime, package manager, test runner, and general-purpose builder.

## Consequences

Installs, scripts, tests, and first-party builds use one fast tool, reducing setup and maintenance. Framework-specific tools remain where Bun does not replace their integrations. Bun compatibility becomes a dependency constraint, and new package versions are delayed by 24 hours to reduce supply-chain risk.
