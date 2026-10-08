# 0020: Preserve scroll past the Select popup

## Status

Accepted (2026-10-08)

## Context

Opening the agent filter on a scrolled page can reset the document to the top: `@base-ui/react@1.8.0`'s useListNavigation calls scrollIntoView on the highlighted option without preventScroll before the non-modal popup has final positioning. Alternatives were accepting the jump or patching the package.

## Decision

Capture the scroll position on trigger press and retry restoring it — bounded and stopping on user scroll — until the popup settles.

## Consequences

A local, removable workaround that is timing-based and only verified against `@base-ui/react@1.8.0`; upgrades must re-check or delete it. No upstream issue was filed when this was written.
