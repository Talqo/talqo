# 0002: Use pnpm 11

## Status

Accepted (2026-07-11)

## Context

Talqo needs fast, reproducible installs and reliable workspace and CI support. pnpm provides strict dependency isolation, efficient storage, and strong supply-chain controls. Bun is faster in some operations but would add contributor and compatibility risk; supporting multiple package managers would cause lockfile drift.

## Decision

Use pnpm 11 as the sole supported package manager.

## Consequences

We commit only `pnpm-lock.yaml` and use frozen installs in CI and production builds. Contributors must install pnpm, and packages relying on undeclared dependencies may require fixes.
