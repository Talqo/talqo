# 0012: Use RFC 9457 Problem Details

## Status

Accepted (2026-08-31)

## Context

Talqo API errors used English `{ error: string }` bodies that clients could not handle or localize reliably. Status-only handling loses domain meaning, while custom per-route shapes fragment the OpenAPI contract.

## Decision

Represent every API error as strict RFC 9457 `application/problem+json` with only a documented `type` URI and a stable Talqo `code` extension.

## Consequences

Clients receive one closed machine-readable contract and own localized presentation. The API must maintain a semantic code catalog, public problem documentation, and exact boundary normalization; occurrence-specific details are unavailable unless this decision is superseded.
