# Dashboard Test Chat Design

## Purpose

Implement FR-2.13: an operator tests an agent through a live chat on the agent page, without an embed. The chat runs the same pipeline visitors get: saved system prompt, blacklist, knowledge base retrieval, MCP tools, streaming, cancellation, recovery, and usage accounting.

## Decisions

| Topic | Decision |
| --- | --- |
| Access | `agents:manage` on the agent. Each test conversation is private to the operator who started it. |
| Visibility | Stored through the normal conversation pipeline, but excluded from the Conversations list and from conversation and message statistics. Token usage counts toward the agent's usage because it is real provider spend. |
| Limits | Exempt from the per-network daily question allowance. Keeps one active response per conversation, the input-length bound, and output caps. Concurrent generations per operator and agent are capped by the existing `TALQO_CHAT_MAX_CONCURRENT_GENERATIONS_PER_IP` value. |
| UI | A "Test chat" tab on the agent detail page, built in `apps/web` on `@talqo/sdk`. It needs no embed, ignores embed appearance, and does not touch the widget. |
| Persistence across reload | None. The dashboard uses SDK memory storage, so a reload starts a new test chat; the abandoned one remains hidden and keeps its usage. |

## Data Model

One migration on `conversation`:

- `origin` enum `embed | dashboard`, not null, default `embed` for existing rows.
- `operator_id` nullable FK to `user.id`, `ON DELETE SET NULL`, so deleting an operator keeps the usage their tests produced. `SET NULL` leaves the conversation unreachable, which is the intended end state.
- `embed_access_version` becomes nullable.
- Checks: `origin = 'dashboard'` implies `embed_id IS NULL AND embed_access_version IS NULL`; `origin = 'embed'` implies `embed_access_version IS NOT NULL AND operator_id IS NULL`.

`generation_attempt.network_hash` becomes nullable; dashboard attempts store null so they never count against visitor network concurrency.

The FK into `identity`'s `user` table uses the schema-only foreign-key exception in `docs/architecture.md`.

## API

New operator routes under the conversation module, declared with `access.agent(agents:manage)`:

| Route | Behavior |
| --- | --- |
| `POST /agents/{agentId}/test-chat/messages` | Body `{ conversationId, requestId, text }`. Same SSE event stream and pre-stream problem details as the public send. Creates the conversation on first message. |
| `GET /agents/{agentId}/test-chat/conversations/{conversationId}` | Same session-state schema as the public session route. |
| `POST /agents/{agentId}/test-chat/conversations/{conversationId}/cancel` | Same body and semantics as the public cancel. |

The conversation ID is client-generated UUIDv4, as in public chat, but authorization comes from the operator session: the conversation must have `origin = 'dashboard'`, the caller as `operator_id`, and the path's agent. A mismatch answers `conversation-not-found`, never revealing another operator's conversation. Conversation IDs are not added to `ROUTE_ID_FIELDS`.

### Service

`conversation.service` gains a dashboard send, session load, and cancel. The send path is factored so embed resolution and admission are the only differences:

- Embed send: resolve embed, require enabled, lock embed row, per-network concurrency and daily allowance.
- Dashboard send: verify agent ownership of an existing conversation, per-operator concurrency, no daily allowance, no embed lock.

Everything after acceptance (`run`, finalization, usage, recovery, blacklist, retrieval, tools) is shared unchanged.

Repository queries backing `listConversations`, `findConversationByReference`, and the daily/active conversation and message counts filter `origin = 'embed'`. Usage totals are not filtered.

## SDK

`@talqo/sdk` is unpublished (`0.0.0`), so small option changes are acceptable:

- `createChatClient` accepts either `embedToken` (default fetch transport and optional storage, as today) or a required custom `transport` without an embed token, in which case storage is memory-only. `TransportContext.embedToken` becomes optional; the public routes fail fast when it is missing.
- `createFetchChatTransport` accepts `endpoints`, which choose each session operation's path, credential delivery, and extra body fields. SSE framing, event validation, and problem-details parsing stay in the SDK, so the dashboard does not reimplement them.

## Web

- `features/test-chat/`: the SDK fetch transport with `endpoints` built from the generated route URLs and cookie credentials, plus a `TestChatCard` that owns the client for its subscription lifetime (StrictMode-safe).
- The card reuses `Transcript` for messages and adds a composer, Stop, Retry, and New chat, with localized states for SDK errors (provider unavailable, conversation full, busy, lost access, generic failure) and tool activity. A rejected message keeps its draft.
- Only `ai_provider:manage` can read provider health, so the tab does not pre-check it: a missing or failing provider surfaces on send as the provider error, with a pointer to the AI provider settings.
- Unsaved configuration edits are not used; the tab says the chat uses the saved configuration.
- The web Orval config disables `forceSuccessResponse` for the SSE operation only, because the generated success path cannot type an event stream.
- Locale keys added to every web locale.

## Failure Behavior

- Provider missing or unusable: pre-stream `provider-error`, rendered with a pointer to the AI provider settings; the draft is kept.
- Lost `agents:manage` mid-session: next request answers 403; the tab shows the access-denied state.
- Agent deletion: conversations cascade as today; in-flight generations abort through the existing poller.
- Operator deletion: conversation becomes unreachable, usage retained.

## Verification

- Integration (`conversation.integration.test.ts`): dashboard send streams and persists; daily allowance not consumed; per-operator concurrency; another operator and another agent get not-found; dashboard conversations absent from list, transcript lookup, and conversation/message counts; usage recorded; operator deletion keeps usage.
- Access: route without `agents:manage` answers 403.
- SDK unit tests: transport-only client without an embed token, memory storage enforced, fetch transport rejects a missing token.
- Web component tests: send/stream/stop/retry/new chat, error states, provider-missing state.
- E2E: operator opens an agent with no embeds, sends a message, receives the fake-provider reply.
- Contracts regenerated for web and SDK clients; SRS FR-2.13 marked Done; ERD updated for the new columns.
