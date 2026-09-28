# 0015: Convert uploaded files with Docling Serve

## Status

Accepted (2026-09-27)

## Context

Operators upload `.txt`, `.md`, `.docx`, and `.pdf` files as agent knowledge. Uniform conversion and chunking of these formats needs Python parsing libraries, which must never enter the Bun/TypeScript app images. Per-format JavaScript parsers recover poor text for PDF and DOCX, and hosted parsers expose private operator content and internet dependency.

## Decision

Convert and chunk uploads through a pinned, self-hosted Docling Serve container over HTTP (`POST /v1/chunk/hybrid/file`). The API submits original bytes and receives bounded, structure-aware chunks. The endpoint is deployment-wired and validated at boot, never user-supplied.

## Consequences

Every deployment runs one extra stateless container whose warm footprint holds document models (measured near 1.7 GiB RAM with negligible idle CPU). Image upgrades stay pinned because the chunk response is an external contract. Chunk text, file state, and vectors remain in PostgreSQL.
