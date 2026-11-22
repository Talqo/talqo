---
paths:
  - "**/*.{tsx,jsx}"
---

# React

## State ownership

- Store filters, tabs, or pagination in the URL when opening a link or using Back or Forward should restore them.
- Keep drafts when refetching the same record. Reset them when switching records. Keep row state with the same record when a list reorders.
- Keep cached results separate across account or tenant switches. After a mutation, update or invalidate every view that uses the changed data, including list and detail views.

## Effects and rendering

- Trigger writes from the user action so a remount or effect rerun cannot repeat them. Release subscriptions when their inputs change or the component unmounts. Keep stale responses from overwriting newer results.
- When rendering on the server, make the first client render match the server output. Read browser-only values after hydration or in a client-only component. Fix the cause of hydration mismatches.

## Interaction

- Preserve keyboard navigation and restore focus when an overlay closes. Show distinct loading, empty, and error states. Keep input after a failed submission. Prevent overlapping submissions when they could duplicate a write.
