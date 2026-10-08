# 0019: Render the agent-filter popup non-modally

## Status

Accepted (2026-10-08)

## Context

The agent-filter popup stays open while agents toggle, so operators compare the selection against the charts underneath. Base UI's default modal popup scroll-locks the page behind it; a non-modal popup keeps the page scrollable but relies on tab order instead of a focus trap.

## Decision

Render the agent-filter select popup with `modal={false}`.

## Consequences

The dashboard stays scrollable and visible during multi-pick, and quick-action buttons are reached through normal tab order. The non-modal popup exposes the scroll-reset quirk handled by ADR-0020.
