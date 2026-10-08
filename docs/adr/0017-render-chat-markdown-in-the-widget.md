# 0017: Render chat markdown in the widget

## Status

Accepted (2026-10-03)

## Context

Assistant answers are markdown source delivered verbatim in `ChatMessage.text`. The framework-independent, workspace-private SDK owns chat state and transport; the presentation-only widget is its sole consumer, and shared-code rules require measured cross-app reuse before extraction. Rejected: SDK-core rendering behind an opt-out flag (breaks framework independence; published removal is breaking, later relocation mechanical); SDK-emitted sanitized HTML (shifts XSS burden to consumers); exposed AST (leaks the render model); server-side rendering (defeats streaming).

## Decision

Render assistant markdown in `apps/widget` as presentation; the SDK keeps `ChatMessage.text` as raw markdown source and never emits rendered HTML strings.

## Consequences

The widget adds react-markdown and remark-gfm, never rehype-raw; links open with `target="_blank" rel="noopener noreferrer"`; only assistant messages render markdown; prose scopes under `.talqo-widget`. Rendering is React-coupled inside the widget, and any second rendering surface duplicates this setup until cross-app reuse is measured.
