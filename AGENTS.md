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
- **Docs.** Update `docs/architecture.md` only when architecture, boundaries, ownership, or canonical structure change. Update `docs/ERD.md` and `docs/SRS.md` only when their content becomes wrong. None of these record implementation details; those belong in code or a spec. Update `apps/docs` only for information the UI does not provide.

## Code

- When creating a PR, follow template inside `.github/pull_request_template.md`.
- Follow [the architecture guide](docs/architecture.md) and the nearest `AGENTS.md`.
- Default to no ADR. Write one in [`docs/adr`](docs/adr) only for a decision with credible alternatives and real tradeoffs a future contributor would reopen, and never for implementation details. Follow [its rules](docs/adr/AGENTS.md).
- Before adding a paragraph to any doc, ask what a maintainer would get wrong without it. If the code answers the question, leave it out.
- Never hand-edit generated artifacts, except migration SQL. Keep migration snapshots and journals generated.
- Each PR may add at most one database migration.
- Preserve relational normalization. Model relationships with foreign keys and junction tables, not arrays or JSON collections of IDs.
- If a rule here blocks the task in front of you, say so and get a human decision before breaking it.

## Feedback loop

Run only the checks your change can break. CI runs all of them except `e2e` on every pull request.

```sh
bun run quality:fix      # any edit
bun run typecheck        # any code edit
bun run test             # changed behavior or its tests
bun run test:integration # module, database, service, or route
bun run contracts:check  # API contract or generated client
bun run e2e              # web, widget, SDK, or API request handling; never run on PRs
bun run i18n:fix         # app locales or translated keys
bun run actions:check    # .github/workflows
```

Docs-only changes need no tests.
