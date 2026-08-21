# Talqo

Talqo is an AI agent for any website. It can answer from configured context or call MCP tools. It is written to be production-ready, open-source and self-hosted.

- When creating a PR, follow template inside `.github/pull_request_template.md`.
- Follow [the architecture guide](docs/architecture.md) and the nearest `AGENTS.md`.
- Every app owns its locales in `apps/*/src/locales/<lang>.json` with its own i18next instance; never share locale files. Extend all locale JSONs of one app together when adding or renaming a key, and keep key sets identical across languages. Call `t()` with literal keys so i18next-cli checks stay accurate; for dynamic picks, map from an explicit constant list.
- Never hand-edit generated artifacts.
- Record significant architectural decisions in `docs/adr`.
- Update `docs/architecture.md` in the same change when architecture, boundaries, ownership, or canonical structure changes.
- Keep E2E data in the API-owned seed for an isolated test database.

Run after changes. All commands work without env setup unless noted:

```sh
bun run quality:fix
bun run typecheck
bun run test            # unit tests only; hermetic, no database
bun run contracts:check # only if API contracts or generated web client changed
bun run i18n:fix
bun run test:integration # needs Docker for the throwaway Postgres
bun run e2e             # needs browsers; not covered by CI
bun run actions:check   # only if GH actions changed; needs actionlint and zizmor on PATH
```
