# Talqo

Talqo is an AI agent for any website. It can be configured to answer based on the provided context or by calling MCP tools. This app is fully production-ready, open-source and is built on the latest industry standards.

## Notes

- When creating a PR, follow template inside `.github/pull_request_template.md`.
- Document significant architectural decisions in `docs/adr`.
- Put shared shadcn components and styles in `packages/ui`.

## Feedback loop

Run after changes

```sh
bun run quality:fix
bun run typecheck
bun test
```
