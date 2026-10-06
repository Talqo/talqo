# 0018: Keep the statistics agent filter in page-local state

## Status

Proposed (2026-10-06)

## Context

The multi-agent filter needed a home. A URL search parameter (`/dashboard?agents=…`) makes selections shareable and back/forward-restorable, but every toggle rewrote the URL, reset scroll position, and deactivated the Dashboard nav item (active matching compares search by default). Page-local state avoids all of that but cannot be shared via a link.

## Decision

Keep the agent selection in React state only, with no route search parameter, and redirect `/dashboard/analytics` to plain `/dashboard`.

## Consequences

Toggling agents no longer touches the URL, scroll, or navigation highlight, and route typing stays simple. Selections cannot be bookmarked — acceptable because statistics is a monitoring view the operator lands on, not a resource to link to. Nav matching still sets `includeSearch: false` defensively.
