# Talqo

Talqo is an AI agent for any website. It can answer from configured context or call MCP tools.

## What makes Talqo special

- **Simple.** One obvious path per task.
- **Open source.** Fork it, extend it, keep it running if we disappear.
- **Self-hostable.** One API process, one PostgreSQL, containers you already run. No required external SaaS.
- **Bring your own frontend.** Advanced users build custom UIs on the headless SDK, with the same backend, token, and enforcement as the pre-built widget.

## What we never compromise on

- **Our operators are not technical.** Most run an e-shop. No internal jargon in UI copy, defaults must work with zero configuration, and destructive actions need plain-language confirmation plus one recovery step.
- **Simple wins.** If a feature needs a second concept to explain, cut it rather than adding a setting or a flag.
- **Self-hostable means no lock-in.** No required external SaaS and no vendor lock-in.
- **No feature is demo-grade.** Every feature works end to end, with tests and error handling, before you call it done.

## Vocabulary

- **agent**: The configured AI persona (system prompt, blacklist, knowledge base, MCP tools) that answers end users. Not the coding assistant changing this repo.
- **operator**: The dashboard user who configures agents and monitors usage.
- **end user**: The visitor on the operator's website who chats with an agent.
- **embed**: One configured website integration: the agent it points at, its public token, and its appearance. The SDK reads it, and any UI uses its token to talk to the API.
- **widget**: The pre-built chat UI. One of many UIs that can use an embed token through the SDK, not a synonym for embed.
- **SDK**: The headless client any UI uses to talk to the API with an embed token.
- **knowledge base**: The uploads and crawled pages an agent references when answering.
- **RAG**: Retrieval-augmented generation. The agent pulls relevant knowledge base chunks into context when responding.
- **module**: One business capability under `apps/api/src/modules`, owning its domain behavior, writes, and schema.

## Hit every surface

- **Contracts.** Changing an API contract touches `apps/api` and both generated clients in the same change.
- **Entry points.** An end-user behavior must work identically in the widget, in the dashboard preview, and in custom SDK UIs. Fixing one UI is not fixing the feature.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Agent deletion needs its dependent cleanup.
- **Docs.** Check whether the change makes `docs/architecture.md`, the ERD, the SRS, or the user documentation in `apps/docs` inaccurate.

## Code

- When creating a PR, follow template inside `.github/pull_request_template.md`.
- Follow [the architecture guide](docs/architecture.md) and the nearest `AGENTS.md`.
- Write an ADR in [`docs/adr`](docs/adr) when a decision had credible alternatives with real tradeoffs; follow [its rules](docs/adr/AGENTS.md).
- Before adding a paragraph to any doc, ask what a maintainer would get wrong without it. If the code answers the question, leave it out.
- Never hand-edit generated artifacts.
- If a rule here blocks the task in front of you, say so and get a human decision before breaking it.

Run after changes:

```sh
bun run quality:fix
bun run typecheck
bun run test
bun run test:integration
bun run e2e
bun run contracts:check
bun run i18n:fix         # only if app locales or translated keys changed
bun run actions:check    # only if .github/workflows changed
```
