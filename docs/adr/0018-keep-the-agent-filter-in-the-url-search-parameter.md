# 0018: Keep the agent filter in the URL search parameter

## Status

Accepted (2026-10-08)

## Context

The multi-agent statistics filter needs a home. Page-local state never touches the URL, but a statistics view is exactly what operators paste into chat for each other, and a local filter cannot be shared. Alternatives: page-local state, or a validated `agents` route search parameter rewritten on every toggle — accepting one id or an id list, deduped, with history entries replaced and scroll preserved.

## Decision

Keep the agent selection in the `agents` search parameter; a missing parameter means every agent.

## Consequences

`/dashboard?agents=["…"]` opens exactly the filtered view for anyone with access, and old `/dashboard/analytics` links redirect with the filter intact. Each toggle rewrites the URL, so route rendering must stay cheap, ids of deleted agents are ignored against the loaded list, and the sidebar highlight must ignore the parameter (`includeSearch: false`).
