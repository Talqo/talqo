# MCP Tools Design

## Status

Implemented (2026-10-05).

## Goal and scope

Let an operator give an agent access to external tools over MCP, so the agent can answer from live structured data — stock levels, orders, prices — instead of only from uploaded documents and its own context. Satisfies FR-2.18 and FR-2.19.

Included:

- Per-agent MCP server configuration, managed from a new `mcp` tab on the agent page.
- Both non-deprecated MCP transports: Streamable HTTP, addressed by URL, and stdio, addressed by a command to run.
- Three HTTP auth modes: `none`, static request headers, OAuth 2.1. stdio servers take credentials from their environment map.
- A discovery pass on save that connects, fetches the server's tool list, and populates the operator's tool selection. Whether a connection works is inferred from whether it has tools, so there is no separate test action and no stored health.
- Per-server enable/disable that preserves configuration.
- Tool resolution and invocation during chat, with tool activity visible to end users.
- Graceful degradation: an unreachable, unrunnable, or failing MCP server never fails a chat reply.

Excluded:

- A shared or global MCP server store. Servers belong to exactly one agent.
- The HTTP+SSE transport, deprecated by the specification.
- MCP resources, prompts, completions, sampling, roots, and logging. Tools only.
- A working directory for stdio servers. Operators run business-data tools, not filesystem tools.
- Deployment-level environment defaults. Server environment is entered in the MCP form and nowhere else.
- Any limit on how many servers an agent may have enabled.
- Persisting tool arguments or results. Tool activity is streamed, not stored.
- Server discovery, a public registry, and importing `.mcp.json` files.

## Decisions

**Cardinality is one agent to many servers with no global store.** `mcp_server.agent_id` is a non-null FK with `onDelete: "cascade"`, matching `agent_file`, `usage_record`, and `blacklist_word`. The alternative — a shared connection table plus a per-agent join — was rejected because it makes the operator manage two things (a connection, and which agents use it), needs a second screen outside the agent page, and silently grants every attached agent the connection's credential. `docs/architecture/module-diagram.md:70` currently states the opposite and is corrected by this design. Recorded in ADR-0017.

Duplication is accepted: an operator running several agents against the same backend re-enters a URL and token. If that becomes real friction, extracting a shared connection table later is possible but not free — credential envelopes are bound to their row id by associated data, so the migration must decrypt and re-encrypt rather than move rows.

**Transports are Streamable HTTP and stdio.** HTTP+SSE is excluded because the specification deprecated it, and deprecated mechanisms are not implemented.

The client names these differently from this document. Its transport config accepts exactly `type: 'sse' | 'http'`, where `'http'` **is** Streamable HTTP and `'sse'` is the deprecated HTTP+SSE transport. So `mcp_transport = 'http'` maps to `{ type: 'http', url, headers?, authProvider? }`, and `mcp_transport = 'stdio'` maps to an `Experimental_StdioMCPTransport` instance rather than to a config object, because stdio is not expressible in that union.

Supporting stdio costs a real constraint on the deployment image. `oven/bun:1.4.2-slim` carries no Python, so a stdio server written in Python cannot run unmodified. What it does carry is `bun`, `bunx`, a POSIX shell, and a `node` shim for bun already on `PATH`, so npm-distributed servers — the largest category — run as-is through `bunx`, including the `-y` flag that upstream MCP documentation uses. Operators who need a Python server run it themselves over an HTTP transport, which most such servers support.

Copy says `bunx`, the runtime's own package runner, rather than `npx`. Bun dispatches on `argv[0]`, so an `npx` symlink to `bunx` would silently run the runtime and reject flags such as `-y`; that is a reason not to pretend the image is Node, not a reason to ship a wrapper. Naming `bunx` keeps the image untouched, and `bunx -y @scope/server` was verified against the image.

Spawning an operator-chosen program is not a privilege escalation: the operator already runs arbitrary code on the machine they deploy Talqo to. The residual risks are resource use and orphaned processes, addressed below.

**Auth has two HTTP modes, environment for stdio.** For HTTP servers, `none` covers internal servers such as a DBHub instance on the operator's network; `headers` covers a static `Authorization: Bearer`, an `X-API-Key`, or any other fixed request header. OAuth was removed during implementation: no authorization flow completed a round trip, so only `none` and `headers` shipped.

stdio has no auth mode. The specification states that stdio servers retrieve credentials from the environment, so the environment map is the credential mechanism, and OAuth has no stdio analogue. For a stdio row, `auth_mode`, `headers`, and both OAuth columns are null, enforced by a check constraint rather than convention.

Static-header servers never execute OAuth code at runtime. No metadata discovery, no token refresh, no extra round trip.

## Boundaries and ownership

- A new `mcp` module owns `mcp_server`, tool discovery, its credential handling, its OAuth provider, and stdio process lifecycle. It exposes only values other modules need and no Drizzle types.
- `mcp` owns the OpenAPI tag `MCP`, so `orval.config.ts` gains `MCP` to the `web` target's tag filter.
- `mcp` imports `agent`'s table for the foreign key only. `mcp.service.ts` imports nothing from `agent` at runtime.
- `conversation` opens tools through one `mcp` service call inside `run`, where the abort signal exists, and closes it in a `finally`. It does not construct MCP clients, spawn processes, read `mcp_server`, or know what a tool is.
- `ai-provider` gains no knowledge of MCP. `invoke` takes an opaque `tools` record and a step bound, and passes both to `streamText`.
- Dependency direction: `conversation -> mcp -> agent`. No cycles. Deleting an agent cascades through the database, not through a service call.

The credential vault moves to `src/lib/credential-vault.ts`, parameterized by key context. `ai-provider` passes `talqo:ai-provider-credentials:v1` and `mcp` passes `talqo:mcp-credentials:v1`, so an envelope from one module cannot be decrypted by the other. The context additionally binds a secret to its purpose — a header value cannot be decrypted as an environment value.

## Data

Table `mcp_server`, owned by `mcp`:

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()`, as in `agent` |
| `agent_id` | text FK | → `agent.id`, `onDelete: "cascade"`, indexed |
| `name` | text | Unique per agent on `lower(name)`, as in `agent` |
| `transport` | `mcp_transport` enum | `http` \| `stdio`. Not nullable |
| `url` | text | Required iff `transport = 'http'`. Must parse as `http:` or `https:` |
| `headers` | jsonb | `{ [name]: CredentialEnvelope }`. Non-null exactly when `auth_mode = 'headers'` |
| `auth_mode` | `mcp_auth_mode` enum | `none` \| `headers` \| `oauth`. Required iff `transport = 'http'`; null for stdio |
| `oauth_tokens` | jsonb | `CredentialEnvelope`. Null unless `auth_mode = 'oauth'`; legitimately null before authorization completes |
| `oauth_client` | jsonb | `CredentialEnvelope`, not plaintext — DCR returns a client secret |
| `oauth_pending` | jsonb | `CredentialEnvelope` holding PKCE verifier, state, and authorization code. Null outside an in-flight authorization |
| `oauth_state_expires_at` | timestamptz | Null unless `oauth_pending` is non-null |
| `command` | text | Required iff `transport = 'stdio'` |
| `args` | jsonb | `string[]`, default `[]`. Empty when `transport = 'http'` |
| `env` | jsonb | `{ [VAR]: CredentialEnvelope }`, default `{}`. Empty when `transport = 'http'` |
| `tools` | jsonb | `[{ name, description, enabled }]` from the last successful discovery |
| `is_disabled` | boolean | Default `false` |
| `revision` | integer | Default `1`. Bumped only by operator edits — see below |
| `created_at` / `updated_at` | timestamptz | |

Index and constraint declarations follow the existing schemas exactly, since `check` is already in use at `ai-provider.schema.ts:16` and `conversation.schema.ts:73`:

```ts
index("mcp_server_agent_id_idx").on(table.agentId),
uniqueIndex("mcp_server_agent_name_unique_idx").on(table.agentId, sql`lower(${table.name})`),
check("mcp_server_transport_fields_check", sql`...`),
check("mcp_server_auth_mode_check", sql`...`),
```

The name uniqueness index is composite on `agent_id` and `lower(name)`, not on `lower(name)` alone. Two agents may each have a server called `Shopify`; one agent may not have two. This is the `blacklist_word` pattern at `agent.schema.ts:28` rather than the `agent` pattern at `:12`.

Each jsonb column is declared `jsonb("...").$type<...>()`, which is how `ai-provider.schema.ts:13-14` keeps a JSON column typed, so a malformed stored shape is a type error rather than a runtime surprise. `updated_at` is written by the repository with `.set({ ..., updatedAt: new Date() })`, matching `agent.repository.ts:76`. There is no database trigger.

No composite index on `is_disabled` is added. The runtime query is "enabled servers for this agent", served by `mcp_server_agent_id_idx`, and expected scale is single digits per agent, so a wider index would cost write amplification for no measurable gain.

The check constraints make a mixed or incomplete row unrepresentable:

- `transport = 'http'` requires `url` non-null, `command` null, and `auth_mode` non-null.
- `transport = 'stdio'` requires `command` non-null, `url` null, and `auth_mode`, `headers`, `oauth_tokens`, `oauth_client`, `oauth_pending`, `oauth_state_expires_at` all null.
- `auth_mode = 'none'` requires `headers`, `oauth_tokens`, `oauth_client`, `oauth_pending`, and `oauth_state_expires_at` all null.
- `auth_mode = 'headers'` requires `headers` non-null and `oauth_tokens`, `oauth_client`, `oauth_pending`, `oauth_state_expires_at` all null.
- `auth_mode = 'oauth'` requires `headers` null. `oauth_client` may be null before authorization completes; `oauth_tokens` may be null until a token is issued; `oauth_pending` and `oauth_state_expires_at` are null or set together.
- `transport = 'http'` requires `args` and `env` to be `[]` and `{}`.

The OAuth direction is deliberately asymmetric. A row moving into `oauth` mode may legitimately hold no tokens yet, so the constraint forbids a token set without `oauth` mode, not the reverse. Everything else is an equality.

`revision` is bumped only by `PUT`, because only an operator edit can conflict with another operator edit. Discovery writes `tools`, and an OAuth callback or refresh writes `oauth_tokens`, `oauth_client`, and `oauth_pending`, all from inside a chat generation or a redirect. If those bumped `revision`, every probe and every token refresh would hand an operator with an open edit form a spurious `configuration-conflict`.

Closed settings are columns so an invalid row cannot exist and changes appear in the migration, following `embed.schema.ts`. The jsonb columns hold what genuinely has no fixed shape: header and environment names are arbitrary, the OAuth token set and its client registration are defined by the authorization server, and discovered tools are machine-shaped and never queried. `args` is a plain string array and `env` is a secret map, so both are narrow despite being jsonb. `ai-provider` draws the same line, with columns for closed settings and jsonb for `text_config` and `embedding_config`.

Secrets are stored as a map from name to envelope rather than an array. Names are unique in both cases — two `Authorization` headers is meaningless, and a duplicated environment variable is not expressible — and names must stay readable in plaintext because they are what gets sent. One shape serves both transports.

`tools` stores only `name`, `description`, and the operator's `enabled` flag. It renders the tool list and records the enabled set; it is never used to execute a call. Schemas for execution are always read live, so a server that changes a tool's parameters cannot leave Talqo calling a stale shape.

Disabling keeps the row, its secrets, and its tool snapshot. It only removes the server from tool resolution, so re-enabling needs no re-entry and no re-discovery.

## Contract surface

All routes nested under the agent, tagged `MCP`, using the existing permission split — `agents:read` to list and read, `agents:manage` to mutate. No new permission: MCP configuration is agent configuration, and a separate capability would be a second concept for the operator.

| Route | Purpose |
|---|---|
| `GET /api/agents/{agentId}/mcp-servers` | List with masked secrets, tool count, and whether tools were found |
| `POST /api/agents/{agentId}/mcp-servers` | Create, then discover its tools |
| `GET /api/agents/{agentId}/mcp-servers/{serverId}` | Read one |
| `PUT /api/agents/{agentId}/mcp-servers/{serverId}` | Update, rediscover when the transport, endpoint, command, or auth changed, preserve tool selection by name |
| `DELETE /api/agents/{agentId}/mcp-servers/{serverId}` | Delete, destroying stored secrets |
| `POST /api/agents/{agentId}/mcp-servers/{serverId}/oauth/authorize` | Begin the OAuth flow, redirect to the authorization server |
| `GET /api/agents/{agentId}/mcp-servers/{serverId}/oauth/callback` | Complete it, then redirect back to the agent tab |

Create and update take a discriminated union keyed on `transport`, so an HTTP body cannot carry `command` and a stdio body cannot carry `auth_mode`. The contract rejects them rather than ignoring them.

Secret values are never returned. HTTP headers come back as `[{ name, hasValue }]`; stdio environment as `[{ name, hasValue }]` under a separate `env` key, so the contract never reveals that storage is a map or that values are individually enveloped.

Reserved header names are rejected, but only those the client or the protocol actually owns. Verified in `@ai-sdk/mcp@2.0.67`: `authorization` is set from the auth provider after caller headers, and `mcp-protocol-version` and `mcp-session-id` are likewise client-managed. Those four cases are rejected — `authorization` in `oauth` mode, where the client manages it, and any name beginning `mcp-` in every mode. An earlier draft of this spec also rejected `mcp-method`, `mcp-name`, `dpop`, and `content-type`; those are not client-managed in this version and rejecting them would be an unjustified restriction rather than a package guarantee. The `mcp-` prefix covers the namespace without asserting specifics that may change.

The callback is the one route that does not answer JSON. It is reached by the operator's browser from the authorization server and answers `302` back to the agent page, so it sits outside the problem-details response path and never renders an API error body to a browser.

Discovery failure is reported as an empty tool list, never as an error status: the save succeeded. New problem codes are `invalid-mcp-server-url`, `duplicate-mcp-server-name`, `mcp-server-not-found`, and `mcp-authorization-server-changed`; `configuration-conflict` and `agent-not-found` are reused. Codes are kebab-case, matching `apps/docs/src/lib/problem-catalog.ts`, and each new code needs an entry there.

## Discovery

Runs on every save. The probe calls the client's `listTools()` for raw tool definitions rather than `tools()`, which builds provider-ready tool objects the dashboard has no use for.

Protocol era discovery is left at its default of `true`, which probes the `2026-07-28` stateless era and falls back to the legacy handshake — the split that exists in the current server population.

1. Connect and list tools.
2. On success: `tools` is replaced with the discovered list, each `enabled` defaulting to `true`, and preserved by name for tools the operator already chose. Tools the server no longer offers disappear.
3. On failure: no tools are written, so the previous snapshot survives and a server that has never answered shows no tools at all.

The save succeeds either way. A server in maintenance must not cost the operator their configuration.

There is no operator-triggered retest. A red dot on the card means the last save found no tools, and saving again is the retry, so a second route and a second button would only give the operator a second thing to understand.

## Process lifecycle

Applies only to stdio. HTTP servers hold no process.

One stdio server is spawned per generation and closed when the generation ends, whatever ends it. The process must stay alive for the whole generation because it serves the tool calls the model decides to make. Respawning per call would move the 253ms spawn cost onto every tool call instead of paying it once.

Every server with a non-empty tool selection therefore starts at the beginning of every generation, not on demand. This is forced rather than chosen: the model needs each tool's schema before it can decide to call one, and the client's tools are built from a connected transport. Measured in the production image, spawning a `bunx`-launched server, completing the handshake, and listing its thirteen tools costs 253ms once the package is installed, and the first install costs 2.6s. Servers start concurrently, so N servers cost roughly one spawn rather than N, and the install cost lands on the probe at configure time rather than on a shopper's first message.

Spawning lazily would move that 253ms onto only the turns that actually call a tool, which for a shop assistant is most of none of them. It is not available without bypassing the client's lifecycle, so it is recorded as a known cost rather than a design gap.

## Where resolution runs

Resolution happens inside `run()`, after the `AbortController` exists — never inside `prepareAndAccept`. This is forced by the existing runtime, not a preference:

- `prepareTextOperation` is called from `prepareAndAccept` before `acceptGenerationAttempt`, so no generation exists yet and no lease or abort signal is available.
- `prepareAndAccept` retries on stale history up to `MAX_HISTORY_ACCEPT_ATTEMPTS`, so anything spawned during prepare would be orphaned on each retry.
- The `accepted.duplicate` path returns without ever calling `run`, orphaning again.
- Every error thrown from `prepare` is converted into `ProviderUnavailableError`. An MCP failure there would be reported to the operator as "the configured text provider is unavailable", which is false.

So `ai-provider` gains one change: `invoke` takes tools alongside the signal it already takes. `PreparedOperation.invoke(signal, tools?)` already late-binds the signal at `conversation.service.ts:227`, and tools follow the same path, so no prepared state captures a tool set.

`run` opens the connection, wraps its existing streaming body in `try`/`finally`, and closes it on every exit. Its `catch` maps a tool failure to a tool error result so the model can continue rather than ending the shopper's conversation.

## Tool loop bound

`streamText` defaults to `stopWhen: isStepCount(1)` (`ai@7.0.127`, `dist/index.js:8610`). Left alone, a tool call executes, the loop stops immediately, and the model never sees the result — every answer would ignore the data while appearing to work. A step bound is therefore mandatory, not an optimisation.

`MAX_TOOL_STEPS = 5`, a code constant owned by `ai-provider` where `streamText` is called. A lookup chain rarely exceeds three or four steps, and each step is a separate billed model call against a deployment that meters tokens and cost per attempt, so the bound has to be low enough that one end-user message cannot multiply into an unbounded bill. The existing generation timeout remains the outer bound.

One consequence to state plainly: a daily message limit no longer bounds model calls, because one message can now cost several steps. `usage_record` already accumulates per attempt, and `generation_attempt` has no step column, so per-message cost becomes the sum across steps without any schema change. Worth watching once real traffic exists.

`mcp` exposes an explicit handle rather than a callback scope, because the generation body is long streaming logic and wrapping it in a closure would be a large, hard-to-review restructure:

```ts
const connection = await mcp.openTools(agentId, controller.signal)
try { for await (const event of prepared.invoke(controller.signal, connection.tools)) { /* ... */ } }
finally { await connection.close() }
```

`openTools` never throws for a server-level failure; it returns whatever it could resolve, possibly with `degraded: true` and no tools. `close` is idempotent, because both an aborted generation and a thrown one must reach it.

Servers are connected concurrently rather than in sequence, because each spawn costs cold-start latency and the model's next token should not wait for the slowest server.

Two code constants owned by `mcp`, not operator settings:

- `MAX_TOOL_DESCRIPTION_CHARACTERS`, bounding the description text handed to the model. Schemas are passed through intact, so this is a guard against verbose descriptions rather than against total tool size.
- `MAX_STDIO_CONNECT_MS`, passed to the client's `initializationOptions` so transport startup and the initialize request are bounded by the package's own mechanism rather than a bespoke timeout.

Concurrency, request options, retries, protocol-era discovery, and session handling are the client's. `mcp` configures them and does not reimplement them: `protocolVersionDiscovery` stays at its default of `true`, `maxRetries` at `0`, and `redirect` at `error`.

`Experimental_StdioMCPTransport` accepts `command`, `args`, `env`, `stderr`, and `cwd`, and offers no output-size bound. A child that writes unbounded stdout is therefore bounded only by the generation timeout and by the container's memory limit, not by Talqo. That is a gap in the transport rather than a choice, and it is recorded under Failure Behavior.

## Tool resolution and invocation

- Take enabled servers only, then discard any whose stored tool set is all disabled before connecting. A server with no enabled tools contributes nothing, so it must not cost a process or a round trip. Turning every tool off is therefore a cheaper way to keep a server configured but idle than disabling it.
- Connect and call `listTools()` live per generation, intersected with the stored `enabled` flags. A live fetch is required even when only one tool is enabled, because that tool's current schema is what gets executed. When one server's live fetch fails, that server is dropped for this generation exactly as if it were unreachable — no tools from it, and a structured log line naming it. Only a total failure across every server yields no tools at all.
- The stored snapshot is never used to build a callable tool. It holds no `inputSchema` and there is no transport behind it, so a snapshot-derived tool would be advertised to the model and then fail when called. There is deliberately no degraded fallback here: a server that cannot be reached this turn contributes nothing rather than contributing something broken.
- Tool descriptions are truncated to `MAX_TOOL_DESCRIPTION_CHARACTERS` as they are handed to the model. That bounds description text only; the larger `inputSchema` is passed through, because truncating a schema would produce tool calls that fail validation. The real context guards are the step bound and the existing input-length check.
- An enabled tool the live list no longer offers is skipped rather than reported as an error, so a server that quietly removes a tool degrades instead of breaking the turn.
- Tool names are namespaced and sanitized, because MCP tool names may contain characters the provider tool-name grammar forbids — `shopify.get_product` must not reach `streamText` as-is. This is not optional: the client's own documented way to combine several servers is to spread-merge their tool sets, which silently lets a later server override an earlier one's identically named tool.
  - Build `{sanitize(serverName)}__{sanitize(toolName)}`, where `sanitize` replaces every character outside `[a-zA-Z0-9_-]` with `_`.
  - Then take the **total** result, hash suffix included, to at most 64 characters: when the joined name exceeds 58 characters, replace its tail with `_` followed by the first 6 hex characters of a hash of the full joined name. Truncating to 64 and *then* appending a hash would produce 70 characters and every call would be rejected.
  - The unsanitized server and tool names stay in a per-call map, so operators and end users never see the mangled form.
- A tool call that fails is caught and returned to the model as a tool error result carrying the failure reason, so the model can continue without it. The reason is operator-facing prose, never a raw JSON-RPC or spawn error, because it is rendered in the shopper's transcript.

Spawned stdio processes receive only `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, and `USER` from Talqo's own environment, plus the operator's configured variables. `APP_SECRET`, `DATABASE_URL`, and every other Talqo secret are therefore never visible to operator-chosen code. This is a load-bearing security property of the design, not an incidental default, and it is covered by a test.

`ai-provider` changes are confined to three things, all inside `defaultGenerate`:

- The `Generate` input type gains an optional `tools` record, forwarded to `aiStreamText` alongside `stopWhen: isStepCount(MAX_TOOL_STEPS)`.
- `onToolExecutionStart` and `onToolExecutionEnd` emit tool events into the same `RawGenerationEvent` stream that already carries text and finish, so `conversation` needs no second channel. These are the library's own hooks for this, and `experimental_onToolCallStart` is deprecated in favour of the former, so the stable names are used.
- `result.textStream` stays exactly as it is, so the existing streaming path is untouched.

`onToolExecutionEnd` discriminates on `success`, which is how the failure outcome is determined without inspecting an error's shape.

## Chat Events

Two new `ChatEvent` variants, so the widget, the dashboard preview, and the SDK all change together:

- `{ version: 1, type: "tool-start", serverName, toolName }`
- `{ version: 1, type: "tool-end", serverName, toolName, outcome }` where outcome is `completed`, `failed`, or `cancelled`. An aborted generation emits `tool-end` with `cancelled` rather than leaving the call unresolved, so a client never waits on a call that will never return.

Neither carries arguments or results, and `toolName` is the server's own name rather than the namespaced form sent to the model. Arguments can contain end-user personal data and results can be arbitrarily large, and the widget has no use for them.

**The SDK must change in the same change, or the first `tool-start` ends every chat.** `packages/sdk/src/chat-client.ts:375-385` treats any event that is not `accepted` or `delta` as terminal: it sets `terminalReceived`, clears `activeGenerationId`, and stops. Emitting only the API side would make tool activity silently terminate the shopper's stream. The SDK therefore needs an explicit branch for the two tool events, a public state field for in-flight tool calls so a host UI can render progress, and widget presentation with its own locale keys. `packages/sdk/src/types.ts:91-101` has no field for this today.

`tool-end` with `outcome: "cancelled"` is synthesized by `conversation`, which is the only layer that sees both the abort and the in-flight tool set; `defaultGenerate`'s abort path yields only a `finish cancelled` event and cannot know which tools were running.

Persisting tool calls on `generation_attempt` is excluded. It would let an operator review what the agent did after the fact, which is genuinely useful, but it is a separate change to storage, history, and the dashboard, and shipping it half-done would be worse than not shipping it. The consequence to accept is that a shopper's transcript shows that a tool ran and what it was called, but not what it returned.

## Failure Behavior

- **Discovery fails on save.** Save succeeds. No tools are written, so a connection that has never answered shows none. The agent gains no tools and chat is unaffected.
- **An HTTP server is unreachable during generation.** That server contributes no tools. Every other server still resolves. Chat proceeds.
- **A stdio server fails to spawn, exits immediately, or times out.** Treated exactly as an unreachable HTTP server. The reason is recorded in the structured log, never surfaced to an end user, and the other servers still resolve.
- **Tool resolution fails for any reason.** `openTools` returns an empty tool set with `degraded` set; `conversation` logs `mcp.tools.degraded` and proceeds, exactly as it already does for a failed knowledge-base search. Chat never fails because of MCP.
- **A tool call fails.** Caught, reported to the model as a tool error so it can continue, and `tool-end` carries `outcome: "failed"`. Chat still completes. A third-party integration being broken must never end a shopper's conversation.
- **The generation is aborted mid-call.** `conversation` emits `tool-end` with `outcome: "cancelled"` for every tool the abort caught in flight, so no client is left waiting.
- **A server hangs.** Bounded by `MAX_STDIO_CONNECT_MS`, `MAX_TOOL_STEPS`, the existing generation timeout, and the abort signal.
- **A stdio server writes unbounded stdout.** Not bounded by Talqo, because `Experimental_StdioMCPTransport` exposes no output-size bound. The generation timeout and the container memory limit are the only backstops. Recorded as an accepted gap in the transport, not a decision.
- **An operator enables very many stdio servers.** Accepted risk, with no Talqo-side defense and no cap. Each chat turn spawns one process per enabled stdio server, and an operator who configures dozens on a small deployment can exhaust memory and have the container killed. The failure is loud, external, and recoverable by removing servers, and the decision not to cap is deliberate. Expected scale is single digits, so this is a tail risk rather than a routine one, and concurrency means the per-turn cost stays near one spawn.
- **A stored secret cannot be decrypted** at resolution time, for example after an `APP_SECRET` change. That server is dropped for the generation and a structured log names it; the raw crypto error never reaches a response. A chat turn never writes configuration, so what the operator sees reflects the last save rather than background traffic.
- **OAuth state is missing, mismatched, or expired on callback.** The callback fails with an operator-facing error naming the server and one recovery action: start the connection again. `oauth_pending` is discarded and never partially applied.
- **The discovered authorization-server issuer differs** from the confirmed one. Stored tokens are dropped, `mcp-authorization-server-changed` is returned, and the operator must confirm the new issuer before credentials are sent to it.
- **Duplicate server name within an agent.** Rejected with `duplicate-mcp-server-name`.
- **Concurrent edit.** Rejected with `configuration-conflict` on a stale `revision`.

No MCP failure path returns a raw provider, network, spawn, or JSON-RPC error to a client or an end user.

## Dependency

One new dependency: `@ai-sdk/mcp`, at the version aligned with `ai` v7. It is on the same release train as the `ai` package already in use, has no dependency on `@modelcontextprotocol/sdk` — it implements the wire protocol directly — and its zod peer range is satisfied by the existing `zod` version. It supplies both transports, the MCP client, and the complete OAuth 2.1 flow, so no OAuth library is added.

The HTTP transport is configured with the client's own `MCPTransportConfig`, which takes `type: 'http'`, `url`, `headers`, `authProvider`, and `redirect`. Decrypted header values are passed straight through. The stdio transport comes from the `@ai-sdk/mcp/mcp-stdio` subpath.

`oauth4webapi` and `openid-client` are not added; they duplicate what this client already implements and neither supplies token storage.

One version detail to watch: the package currently depends on `@ai-sdk/provider` one patch ahead of the pinned version in this repo. Align the pins rather than letting two copies install.

## Dashboard

A new `mcp` tab in `AGENT_TABS` alongside `configuration`, `context`, and `embeds`, with the matching key in all three locale files. Its panel lists servers with name, endpoint or command, a dot for whether tools were found, tool count, and an enable toggle that saves immediately. Expanding a server shows the discovered tools as checkboxes bound to the stored selection. Each card carries Edit and Remove, and Edit reuses the add form.

One form with a type selector, not two screens, and it serves both adding and editing. The operator chooses a server address or a program, fills only the fields that apply, and saves to find out whether it works. A second screen would be a second concept for no gain.

Copy uses `bunx`, which the runtime image already provides, rather than `npx`, which it does not. An operator who copies a command from a server's own README will need to change `npx` to `bunx`; that is stated plainly in the docs rather than papered over with a wrapper, because the alternative is a shell script in the image that pretends the runtime is Node. Talqo performs no rewriting of the operator's command; what they type is what runs.

Arguments are added one at a time as removable chips rather than as a shell string or a textarea expecting one per line, so no quoting rules are needed and nothing is silently word-split.

The existing `MCP tools` metric placeholder on the agent cards in `agents.tsx` is filled from the server list, and its `TODO(mcp-api)` comment is removed.

Operator-facing copy avoids protocol vocabulary: the tab is tools, a server is a connection, and a failed probe is a warning with a retry rather than an error dialog. A destructive delete uses the same typed-name confirmation as agent deletion.

`apps/docs` gains a page on connecting an MCP server, carrying the working examples for both transports. For an audience that is not technical, that page is load-bearing rather than optional.

## Verification And Acceptance

- A committed stdio fixture server, a small Bun program speaking MCP over stdio, used by the integration and end-to-end suites.
- Container contract: `bunx` is present in the image and accepts the `-y` flag, verified against it; and a `bunx`-launched stdio server connects and lists tools under Bun, so the Node-only note on the transport does not become a real dependency.
- Unit (`mcp.test.ts`): transport-specific validation on both create and update; URL scheme validation; secret masking in responses; tool-selection preservation across a probe returning a changed tool list; duplicate header and variable names rejected by the map shape.
- Unit (`credential-vault.test.ts`): an `mcp` envelope cannot be decrypted under the `ai-provider` key context and vice versa; a header envelope cannot be decrypted as an environment value; the new JSON-object payload round-trips a numeric field, which the existing string-map payload rejects.
- Integration through service interfaces: create, update, delete for both transports; cascade on agent delete; probe success and failure; failure preserves the previous snapshot; disabled servers excluded from resolution; selection preserved by name when a tool disappears.
- Schema: a fixture proves each check constraint rejects its bad row — `http` with a `command`, `stdio` with a `auth_mode`, `auth_mode = 'none'` with headers, `auth_mode = 'headers'` with no headers, and an `oauth` row with no tokens, which must be accepted.
- Duplicate name returns `duplicate-mcp-server-name`, and a stale `revision` returns `configuration-conflict`. A probe and a token refresh between an operator's read and write must *not* cause the conflict.
- stdio lifecycle: the process exits after a successful generation, after an aborted generation, and after a throwing generation, with no orphans; `close` is safe to call twice; one failing server does not prevent another from resolving; servers connect concurrently.
- Environment isolation: a fixture server that reports its own environment proves `APP_SECRET` and `DATABASE_URL` are absent and the operator's configured variables are present.
- Tool namespacing: two servers exposing the same tool name both remain callable, a dotted name is accepted, and a name whose namespaced form exceeds 64 characters stays within 64 and still routes to the right tool.
- `conversation` integration: a tool result reaches the model and changes the reply — the test fails if the step bound is left at the default of one, since the result would be dropped; `stopWhen` reaches `MAX_TOOL_STEPS`; a throwing resolver degrades to a reply with no tools; a failing tool call yields `outcome: "failed"` and the generation still completes; an abort mid-call yields `outcome: "cancelled"` for every in-flight tool; a disabled tool is absent.
- SDK: a stream carrying `tool-start` and `tool-end` before `terminal` does not terminate early and exposes the in-flight tool in public state. Without this test the existing terminal fallback silently reintroduces the bug.
- Widget: renders in-progress tool activity and the widget locale keys exist for it.
- Contract: routes tests for each route, and `bun run contracts:check` for the regenerated OpenAPI and both clients.
- E2E: create both an HTTP and a stdio connection in the dashboard, see each one's tools, disable one, then confirm chat stops calling it.
- Regression: `bun run quality:fix`, `typecheck`, `test`, `test:integration`, `e2e`, `contracts:check`, `i18n:fix`.

The stdio transport is documented as Node-only and spawns through `cross-spawn`, so it was spiked against Bun before anything else was built. It works: in the production image, a `bunx -y` launched server spawned under Bun, completed the legacy handshake, and returned its thirteen tools. Era discovery cost one spawn, not two, so the fallback of importing the official SDK's `StdioClientTransport` is not needed and the single-MCP-stack property holds.

Because the probe runs when the operator saves rather than when a shopper chats, a first-run package install is paid at configure time instead of on the first customer message.

## Documentation Changes

- `docs/architecture/module-diagram.md:70` — the `mcp` row currently says tool-server integrations are "configured once for the app, shared across all agents", and names the entity `MCP_CONFIG`. Corrected to per-agent ownership and renamed `MCP_SERVER`.
- `docs/ERD.md:18,38` — `MCP_CONFIG` is renamed `MCP_SERVER`. Its relationship to `AGENT` is already correct, so the cardinality fix is to the module diagram alone.
- `docs/SRS.md:120-121` — FR-2.18 and FR-2.19 move off "Not started".
- `apps/docs/content/docs/embed-chat-integration.mdx:28` — states chat does not call MCP tools; becomes inaccurate.
- `apps/docs` gains an MCP connection page carrying the working examples for both transports.
- ADR-0017 records the cardinality decision. No ADR covers transport scope: supporting both non-deprecated transports is the obvious answer, and excluding the deprecated one follows the specification.

## Decision

Per-agent MCP servers over Streamable HTTP or stdio, with HTTP auth by mode and stdio credentials from its environment, tools discovered by probe and enabled by the operator, invoked live during chat, and degrading silently whenever a server misbehaves.