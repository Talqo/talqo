# 0020: Render chat markdown in the shared UI package

## Status

Accepted (2026-10-19)

## Context

ADR-0018 kept markdown rendering in `apps/widget` until a second surface needed it. The dashboard transcript now renders the same assistant answers, and operators must see them as visitors did. Alternatives: duplicate the renderer in `apps/web` (two copies of the safety rules drift apart), or move it into the framework-independent SDK (rejected in ADR-0018 for coupling the SDK to React).

## Decision

Render assistant markdown with one `Markdown` component in `packages/ui`, used by the widget and the dashboard.

## Consequences

Link handling, the raw-HTML ban, and showing images as links instead of fetching them apply to both surfaces from one place. `packages/ui` depends on react-markdown and remark-gfm. Each surface still styles `.talqo-markdown` itself, and the SDK still delivers raw markdown.
