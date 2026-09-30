# 0016: Ship a single deployment image

## Status

Accepted (2026-09-28)

## Context

Self-hosting must stay brutally simple across compose first, then k8s and cloud targets. Split api and web images would force CORS handling, break SameSite=Lax session cookies, and multiply the supported version matrix, while per-platform deploy repos would triple release sync for one image tag.

## Decision

Build one image in this repo where the Bun API serves the dashboard and widget static assets, and keep every platform wrapper as folders in one talqo-deploy repo.

## Consequences

One tag to release and support, same-origin cookies with zero CORS config, and version matched widget assets. Independent frontend scaling or a public widget CDN waits for measured demand, and later embeds stay layout variants of the same bundle.
