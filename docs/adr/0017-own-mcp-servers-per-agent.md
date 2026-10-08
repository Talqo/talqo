# 0017: Own MCP servers per agent

## Status

Accepted (2026-10-05)

## Context

A shared connection store with a per-agent join lets one URL and token serve several agents and centralizes rotation, but makes the operator manage two things, a connection and which agents use it, needs a screen outside the agent page, and grants every attached agent the credential. Per-agent rows duplicate that URL and token. That cost is bounded only if operators run few agents: an assumption, since one agent already serves many embeds.

## Decision

MCP servers belong to exactly one agent. There is no shared store.

## Consequences

The operator manages one concept in one place, and deleting an agent destroys its stored credentials by cascade. Operators running many agents re-enter and rotate per agent. Extracting a shared connection later is possible but not free: envelopes are bound to their row id by associated data, so the migration must decrypt and re-encrypt rather than move rows.