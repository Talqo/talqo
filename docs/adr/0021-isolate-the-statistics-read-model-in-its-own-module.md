# 0021: Isolate the statistics read model in its own module

## Status

Accepted (2026-10-08)

## Context

The statistics overview composes conversation counts, usage token sums, and agent names into one read model. Keeping it inside `conversation` couples a write-side chat module to a growing dashboard surface; querying conversation tables from a route would break module data ownership.

## Decision

Own the statistics read model, its `/api/stats` routes, and its development fixtures in a `stats` module that reads other domains only through their service APIs.

## Consequences

`conversation` exposes raw daily aggregates as service functions, and the stats → conversation/usage/agent direction stays acyclic. The seed fixture still writes conversation and usage rows directly — no service API models deterministic historical inserts — as the recorded seed exception; drop it once a service can express fixture inserts.
