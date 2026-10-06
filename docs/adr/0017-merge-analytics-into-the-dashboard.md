# 0017: Merge the analytics page into the dashboard landing page

## Status

Proposed (2026-10-06)

## Context

The dashboard landing page showed only a welcome message while usage statistics lived on a separate `/dashboard/analytics` page, so operators had two entry points and a dead-end landing page. Alternatives: keep both pages and cross-link them, or merge the statistics content into the landing page. Keeping two pages duplicates navigation and leaves the landing page without data; merging makes one obvious path but couples the landing page to the `agents:read` permission.

## Decision

Merge the statistics dashboard into `/dashboard` and redirect old `/dashboard/analytics` links to it.

## Consequences

Operators get statistics one click after login and old links keep working. The landing page now requires `agents:read`, so members without it see the access-denied card instead of an empty welcome page; the nav item carries the same requirement. The page grew, so its cards are grouped under visible section headings.
