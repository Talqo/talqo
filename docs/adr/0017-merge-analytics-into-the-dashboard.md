# 0017: Merge analytics into the dashboard landing page

## Status

Accepted (2026-10-08)

## Context

The dashboard landing page was a welcome-only dead end while usage statistics lived on a separate `/dashboard/analytics` page. Keeping both leaves two navigation entry points and an operator's first screen without data; merging couples the landing page to the `agents:read` permission.

## Decision

Merge the statistics view into `/dashboard` and redirect `/dashboard/analytics` to it.

## Consequences

Operators reach statistics one click after login and old links keep working. Members without `agents:read` now see the access-denied card on the landing page, so the dashboard nav item carries the same permission requirement.
