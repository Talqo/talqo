# 0019: Merge analytics into the dashboard landing page

## Status

Accepted (2026-10-08)

## Context

After login operators check the state of their agents. The landing page only repeated sidebar links. Statistics lived a click away on `/dashboard/analytics`. Alternatives: keep both pages and cross-link them, or merge the statistics view into the landing page. Two overlapping navigation surfaces drift apart and teach two mental models. Merging couples the landing page to the `agents:read` permission.

## Decision

Make the statistics overview the `/dashboard` landing page and redirect `/dashboard/analytics` to it.

## Consequences

Statistics sit on the `/dashboard` landing page. Navigation has one path. Old `/dashboard/analytics` links redirect. Members without `agents:read` see the access-denied card on the landing page, and the dashboard nav item carries the same permission requirement.
