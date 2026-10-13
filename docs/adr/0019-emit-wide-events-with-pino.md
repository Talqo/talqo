# 0019: Emit wide events with pino

## Status

Accepted (2026-10-11)

## Context

The API needs one structured JSON event per request that can never block or fail the request, and that stays bounded in memory when stdout is slow. Self-hosters must not need a collector. Synchronous `console.log` blocks and is unbounded. The OpenTelemetry SDK needs a collector and brings far more surface than one log line. A hand-rolled `Bun.stdout` writer would have to reimplement buffering, capping, and drop accounting.

## Decision

Write wide events through pino to an async sonic-boom stdout destination capped by `maxLength`.

## Consequences

Each event is one buffered JSON line on stdout, so any log shipper can collect it. A full buffer drops lines, and the next written line reports the count in `log.dropped`. pino and its small dependency tree become a runtime dependency. Events buffered at shutdown are flushed on SIGINT and SIGTERM.
