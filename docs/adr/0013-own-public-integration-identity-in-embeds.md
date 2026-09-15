# 0013: Own public integration identity in embeds

## Status

Accepted (2026-09-11)

## Context

Agent-level and widget-configuration tokens represented competing public identities. Existing widget-configuration rows and installed `data-talqo-widget` snippets must survive a canonical domain rename without exposing agent selection to public callers.

## Decision

Store each public token and access version on an embed, derive its agent server-side, and retain the old script attribute and configuration URL only as compatibility adapters.

## Consequences

One agent can serve multiple independently rotatable embeds, rotation and reassignment can revoke future sessions by incrementing `accessVersion`, and shipped snippets continue loading. New contracts and dashboard routes use embed terminology; compatibility paths are intentionally absent from OpenAPI.
