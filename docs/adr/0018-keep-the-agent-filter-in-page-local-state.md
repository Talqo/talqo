# 0018: Keep the agent filter in page-local state

## Status

Accepted (2026-10-08)

## Context

The multi-agent statistics filter needs a home. A URL search parameter makes selections shareable, but every toggle rewrites the URL, resets scroll, and flickers the Dashboard nav highlight because active matching compares search by default. Page-local state avoids all of that but cannot be shared as a link.

## Decision

Keep the agent selection in page-local React state, with no route search parameter.

## Consequences

Toggling agents never touches the URL, scroll, or navigation highlight. Selections cannot be bookmarked — acceptable for a monitoring view the operator lands on rather than a resource to link to.
