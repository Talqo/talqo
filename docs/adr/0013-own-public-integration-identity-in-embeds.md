# 0013: Own public integration identity in embeds

## Status

Accepted (2026-09-11)

## Context

Agent-level and widget-configuration tokens represented competing public identities. Exposing agent selection to public callers would let any embed address any agent, and every additional public entry point carries its own authentication exemption and CORS grant. Embeds are the unit operators configure, rotate, and reassign.

## Decision

Store each public token and access version on an embed and derive its agent server-side, exposing exactly one script attribute and one configuration endpoint: `data-talqo-embed-token` and `/api/embed-config/:token`.

## Consequences

One agent can serve multiple independently rotatable embeds, and rotation and reassignment revoke future sessions by incrementing `accessVersion`. The public surface is one attribute, one endpoint, one CORS grant, and one authentication exemption. New contracts and dashboard routes use embed terminology.
