# 0019: Render the agent-filter select popup non-modally

## Status

Proposed (2026-10-06)

## Context

The agent filter uses a multi-select popup that stays open while items toggle. Base UI's default modal popup applies a scroll lock to the page behind it, which feels broken while comparing the selection against the charts underneath; arrow-key navigation already keeps focus inside the popup. A non-modal popup keeps the page scrollable but relies on tab order instead of a focus trap, and exposes the browser quirk worked around in ADR-0020.

## Decision

Render the agent-filter select popup with `modal={false}`.

## Consequences

The dashboard stays scrollable and visible while picking several agents. Keyboard users reach the popup's quick-action buttons through normal tab order rather than arrow keys, and the layout's tab flow must stay sane as the popup is portaled. The scroll-reset side effect needs ADR-0020's workaround.
