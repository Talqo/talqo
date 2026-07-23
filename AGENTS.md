# Talqo

Talqo is an AI agent for any website. It can answer from configured context or call MCP tools. It is written to be production-ready, open-source and self-hosted.

- When creating a PR, follow template inside `.github/pull_request_template.md`.
- Follow [the architecture guide](docs/architecture.md) and the nearest `AGENTS.md`.
- Put shared shadcn components and styles in `packages/ui`.
- Never hand-edit generated artifacts.
- Record significant architectural decisions in `docs/adr`.
- Update `docs/architecture.md` in the same change when architecture, boundaries, ownership, or canonical structure changes.
- Keep E2E data in the API-owned seed for an isolated test database.

Run after changes:

```sh
bun run quality:fix
bun run typecheck
bun test
bun run actions:check  # only if GH actions changed
```
