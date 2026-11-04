# 0021: Use Fumadocs for public documentation

## Status

Accepted (2026-11-02)

## Context

Public docs must be readable and editable by agents as well as people. Fumadocs exposes generated Markdown, `llms.txt`, content negotiation, and MCP helpers from the same MDX source. Rejected: Astro Starlight (simpler static hosting, no first-class LLM surface); Docusaurus (mature, heavy client, LLM support only through plugins); Mintlify (hosted, proprietary, conflicts with self-hosting).

## Decision

Keep Fumadocs as the public documentation framework and serve generated Markdown, `llms.txt`, `llms-full.txt`, and MCP from `apps/docs`.

## Consequences

The docs site keeps one source of truth and its existing SSR deployment. It gains endpoints that must stay generated from source, and keeps the Bun entry point that serves assets and the SSR bundle.
