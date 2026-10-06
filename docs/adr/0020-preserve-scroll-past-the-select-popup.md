# 0020: Preserve scroll past the Base UI select popup

## Status

Proposed (2026-10-06)

## Context

Opening the agent filter on a scrolled dashboard can jump the page to the top. The cause is `useListNavigation` in `@base-ui/react@1.8.0` (`floating-ui-react/hooks/useListNavigation.js`, around lines 162-172): it calls `scrollIntoView` on the freshly highlighted option without `preventScroll` on the accompanying focus, and while the non-modal popup still lacks final positioning the document scrolls. Alternatives: accept the jump, fork or patch the package, or capture the scroll position and restore it.

## Decision

Capture the scroll position on trigger press and retry restoring it (bounded, stopping on user scroll) until the popup settles.

## Consequences

The workaround is local and removable, but timing-based and only verified against @base-ui/react 1.8.0; upgrades must re-check or drop it. No upstream issue was filed when this was written — an upgrade that fixes the root cause should delete this hook.
