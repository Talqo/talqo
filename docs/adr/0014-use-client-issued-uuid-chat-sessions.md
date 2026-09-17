# 0014: Use client-issued UUID chat sessions

## Status

Accepted (2026-09-14)

## Context

The browser must retain session authority when the first accepted response is lost. Server-derived credentials required a custom bootstrap secret, HMAC derivation, recovery endpoint, and cancellation path. A Web Crypto UUID carried over HTTPS already provides sufficient bearer entropy and can be stored before the first request.

## Decision

Use a client-issued UUIDv4 as the chat bearer credential, store only its SHA-256 hash server-side, and use separate UUIDv4 request IDs for idempotency.

## Consequences

All sends use one authenticated route, and uncertain first responses recover through normal session loading. The SDK needs no custom token encoding or bootstrap flow. Database disclosure still cannot replay live credentials, but host-page scripts can read credentials kept in local storage.
