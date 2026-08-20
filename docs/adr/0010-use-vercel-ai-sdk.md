# 0010: Use the Vercel AI SDK

## Status

Accepted (2026-08-20)

## Context

Talqo must construct text and embedding models for seven provider integrations while keeping provider credentials and configuration behind one API module. Direct vendor clients duplicate streaming and model interfaces; a Talqo-owned abstraction would repeat mature adapter work.

## Decision

Use the Vercel AI SDK core interfaces and official provider packages behind the `ai-provider` module's registry and service.

## Consequences

Conversation and knowledge code receive consistent model interfaces while provider setup stays isolated. Model discovery remains Talqo-owned because the SDK does not provide a common discovery API. Provider package upgrades require adapter contract tests and review of vendor-specific behavior.
