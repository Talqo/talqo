# Talqo

Talqo is an AI agent for any website. It can answer from configured context or call MCP tools.

## Workspaces

| Path | Purpose |
| --- | --- |
| `apps/api` | Hono API application |
| `apps/web` | React web application |
| `apps/docs` | Public documentation application |
| `apps/e2e` | Playwright cross-system browser tests |
| `packages/ui` | Shared presentation components and styles |
| `packages/typescript-config` | Shared TypeScript configuration |

## Setup

```sh
bun install
```

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Run API and web development tasks |
| `bun run docs:dev` | Run the documentation application |
| `bun run e2e` | Run browser E2E tests in Chromium |
| `bun run build` | Build current workspaces |
| `bun run quality` | Check linting and formatting |
| `bun run typecheck` | Type-check current workspaces |
| `bun run test` | Run current workspace tests |

## Project Guides

- [Contributing](CONTRIBUTING.md)
- [Architecture](docs/architecture.md)
- [Architecture decision records](docs/adr/)
