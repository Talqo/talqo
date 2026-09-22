# 0014: Use client-issued UUID conversation IDs

## Status

Accepted (2026-09-14)

## Context

The browser must retain conversation authority when the first accepted response is lost. Separate session and conversation identities have the same lifecycle, while a Web Crypto UUID carried over HTTPS already provides sufficient bearer entropy and can be stored before the first request.

## Decision

Use a client-issued UUIDv4 as both the conversation ID and chat bearer credential, with separate UUIDv4 request IDs for idempotency.

## Consequences

Session persistence, credential hashing, and bootstrap flows are unnecessary. Uncertain first responses recover through normal session loading. Conversation IDs must stay out of URLs and logs because database disclosure or host-page access can replay them.
