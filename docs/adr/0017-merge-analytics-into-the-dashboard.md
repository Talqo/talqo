# 0017: Merge analytics into the dashboard landing page

## Status

Accepted (2026-10-08)

## Context

What an operator most needs after login is the state of their agents, yet the landing page only repeated navigation links the sidebar already offers, and statistics lived a click away on a separate `/dashboard/analytics` page. Alternatives: keep both pages and cross-link them, or merge the statistics view into the landing page. Two overlapping navigation surfaces drift apart and teach two mental models; merging couples the landing page to the `agents:read` permission.

## Decision

Make the statistics overview the `/dashboard` landing page and redirect `/dashboard/analytics` to it.

## Consequences

The most important numbers are one click from login, navigation offers one obvious path, and old links keep working. Members without `agents:read` see the access-denied card on the landing page, and the dashboard nav item carries the same permission requirement.
