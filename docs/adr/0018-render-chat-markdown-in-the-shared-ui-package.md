# 0018: Render chat markdown in the shared UI package

## Status

Accepted (2026-10-20)

## Context

Assistant answers are markdown source delivered verbatim in `ChatMessage.text`. The widget and the dashboard transcript both render them, and operators must see answers as visitors did. Rejected: SDK-core rendering (breaks the SDK's framework independence); SDK-emitted sanitized HTML (shifts XSS burden to consumers); server-side rendering (defeats streaming); a renderer per app (safety rules drift apart).

## Decision

Render assistant markdown with one `Markdown` component in `packages/ui`; the SDK keeps `ChatMessage.text` as raw markdown and never emits rendered HTML.

## Consequences

Both surfaces share one set of safety rules: no rehype-raw, links open with `target="_blank" rel="noopener noreferrer"`, and images render as links instead of being fetched. `packages/ui` depends on react-markdown and remark-gfm. Each surface styles `.talqo-markdown` itself.
