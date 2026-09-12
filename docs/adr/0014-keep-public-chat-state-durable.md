# 0014: Keep public chat state durable

## Status

Accepted (2026-09-12)

## Context

Anonymous multi-turn streaming must survive reloads, disconnects, API process failure, and multiple API instances without treating a public embed token or client-supplied history as session authority. EventSource cannot send the required POST body or bearer header, and in-memory quotas or generation locks cannot coordinate replicas.

## Decision

Use derived bearer sessions with bootstrap recovery, PostgreSQL counters and fenced generation leases, agent-owned cascade deletion, fetch-based POST SSE, and a stateful framework-independent SDK as one durable public-chat boundary.

## Consequences

The server retains authoritative history, usage, allowance, and recovery state while the SDK owns browser session and stream state; retries are idempotent and late workers are fenced. Agent deletion removes chat and usage, but embed rotation or deletion only revokes access. This adds durable writes and approximate fallback usage accounting; SDK distribution remains a separate decision.
