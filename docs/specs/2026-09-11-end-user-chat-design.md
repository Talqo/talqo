# End-User Chat, Embeds, And SDK Design

## Purpose

Deliver public, anonymous, multi-turn streaming chat through the embedded widget and a stateful, framework-independent browser SDK. The model receives the fixed platform system prompt followed by the saved agent system prompt, completed conversation history, and current user message. There is no retrieval or tool execution.

## Scope And Approach

Implement one end-to-end milestone in dependency order: embed identity, conversation persistence/runtime, usage and network enforcement, public transport, SDK, and widget integration. Each implementation change must remain focused, but the public-chat milestone is not complete until the entire path and its safeguards work.

Rejected approaches are a demo-only model round trip with later hardening, and a generalized agent execution framework built before a concrete use case.

Included:

- Rename the existing widget-configuration domain to embeds and remove agent-level embed tokens.
- Fetch embed appearance, including colors, through the SDK.
- Persist conversations, messages, generation outcomes, and token usage.
- Stream assistant responses and support cancellation and reload recovery.
- Protect history with private session credentials.
- Enforce a daily question allowance and concurrency caps by agent and network.
- Rotate embed tokens and revoke affected sessions.
- Retain transcripts for future operator categorization and analysis.
- Warn about and implement permanent conversation/usage deletion when deleting an agent.

Excluded:

- Context-file retrieval, embeddings during chat, MCPs, tools, and summarization.
- Billing, payments, deployment-wide consumption quotas, and token-based allowances.
- Analytics/categorization UI and background categorization jobs.
- Visitor accounts, a separate visitor identity, bot challenges, and cross-conversation history navigation.
- Automatic conversation expiry, retention schedules, and automatic transcript deletion.
- Automatic generation retries and resumable/replayable live streams.
- A React SDK package, admin SDK, or automatic npm publication.

## Architecture And Ownership

```text
widget or custom browser UI
  -> packages/sdk
  -> public conversation API
  -> conversation service
       -> embed service
       -> agent service
       -> ai-provider service
       -> usage service
```

| Owner | Responsibility |
| --- | --- |
| `embed` | Agent association, appearance, public embed token, token rotation, and integration validity |
| `agent` | Fixed platform prompt, saved system prompt, prompt composition, blacklist, existing configuration, and agent deletion |
| `conversation` | Session credentials, conversations, messages, daily allowance counters, generation reservations/lifecycle, and orchestration |
| `ai-provider` | Operation-scoped configured text model; credentials remain private |
| `usage` | Normalize and persist input/output counts attributed to each model-call attempt |
| API HTTP infrastructure | Trusted client-IP resolution, address normalization, and rate-limit HTTP response mapping |
| `packages/sdk` | Public configuration fetching, observable chat state, sessions, storage, transport, streaming, and recovery |
| `apps/widget` | Embedding and UI presentation, using the SDK for all API communication |

Follow `docs/architecture.md`: cross-module runtime imports use service files; routes own HTTP translation; services do not exchange Hono contexts or database transactions. The operation owner orchestrates acyclic service calls. HTTP infrastructure must not become the owner of conversation state merely because an IP participates in a concurrency key.

Expose a text-only runtime model operation from `ai-provider`; do not construct or call an embedding model for chat. This does not otherwise redesign the existing provider-configuration contract.

Retrieval and MCP integrations are out of scope; do not add placeholder modules or interfaces.

## Embed Identity And Migration

An agent has multiple embeds. Each embed owns its visual configuration and public token and references one agent.

- Rename that domain, dashboard terminology, relevant routes/contracts, tests, and documentation to embeds.
- Remove the agent's separate embed-token column, API fields, UI, and rotation operation.
- Preserve current widget-configuration records, agent associations, appearance, and public token values when migrating them to embeds.
- Keep `apps/widget` named widget: it is the prebuilt widget UI, not the generic configuration domain.
- Expose only `embedToken` as the SDK integration identifier. The server derives the agent; public chat callers cannot override it with an agent ID.
- Preserve deployed widget snippets that identify existing configuration records. A narrowly documented compatibility adapter for the existing configuration-token script attribute and public configuration URL is justified by shipped embeds; new snippets and contracts use embed terminology. Do not retain the obsolete agent-token integration mode.
- Update the relevant locale key sets across every language of each affected app. Generate contracts and migrations through existing tooling; never hand-edit generated artifacts.

An embed token is publicly visible on the host website. It selects and permits use of an integration but is not proof of a visitor's identity. Neither that token, an origin header, nor CORS grants access to another session's history.

### Rotation And Invalidation

An operator authorized to manage embeds can rotate a token. Generate a cryptographically random replacement and atomically replace the old token. There is no overlap period. Preserve the embed ID, appearance, association, and historical usage.

Rotation invalidates sessions created under the previous token generation. Bind sessions to an embed access version and check it on authenticated session operations; increment that version on rotation and agent reassignment. Deleting the embed also invalidates its sessions. Do not store the public token as the private session credential.

The old token cannot fetch fresh configuration or start new chat. A previously cached configuration response may remain visible, but cannot authorize generation. The dashboard warns that installed snippets must be updated and provides the replacement snippet.

Already dispatched provider work may still consume resources. Cancellation on invalidation is best-effort; rotation cannot undo a provider call. Revocation must be enforced for subsequent access and sends, rather than relying on browser cache invalidation.

## Sessions And Durable Data

One session owns one conversation in this milestone. There is no separate visitor entity grouping conversations. Before first send, the SDK creates and stores a UUIDv4 bearer credential. Persist only its SHA-256 hash on the server. Send it in an authorization header, never a URL.

Creating a session and accepting its first message is one operation. It validates the embed and atomically acquires the question allowance/concurrency reservation while creating the conversation and initial turn. There is no public endpoint for creating empty sessions. Fetching appearance or opening the widget creates no conversation.

The SDK saves the credential in host-page local storage, keyed by API origin and embed token, through a configurable storage adapter. Memory-only storage is supported. If browser storage fails, chat continues in memory without reload recovery. No browser APIs are accessed at package-import time.

- Reload restores history from the API, not from a separately persisted browser transcript.
- Minimizing the widget does not change the session.
- New chat clears the client's active session and visible transcript. Its next send starts another conversation and does not reset the network allowance.
- Session credentials have no time-based expiry. They remain valid until revoked by the agreed integration lifecycle or agent deletion.
- Other scripts on the host page can access local storage. The script-embedded widget does not isolate credentials from a compromised host page.

Persist messages with stable IDs, roles, ordering, timestamps, and completion outcomes. Track generation attempts separately enough to distinguish accepted, running, completed, failed, cancelled, blocked, and interrupted work, and to deduplicate submissions. A failed turn must not masquerade as a completed assistant response.

### Retention And Deletion

Retain transcripts and usage indefinitely unless the operator deletes the agent. Starting a new chat, hitting a length limit, deleting an embed, and rotating a token do not delete them. Preserve the original agent attribution when an embed is reassigned.

Deleting an agent permanently deletes its conversations, messages, generation attempts, sessions, and associated usage. The confirmation must explicitly state that conversation and usage history will be permanently deleted and cannot be recovered. Preserve the existing restriction on deleting agents with attached embeds: the operator must first remove or reassign those embeds. Conversation history itself does not block agent deletion.

Use database referential integrity to prevent orphaned records and late generation results from recreating deleted data. Owner-declared foreign keys and cascades can implement dependent cleanup without runtime imports into another module's repository. Record this cross-owner deletion invariant and cascade policy in the architecture/ADR update. Agent deletion must race safely with sends, finalization, and usage writes; active provider work is aborted where possible.

## Conversation Input And Length

For each call, use the current saved agent prompt and current configured text model. Assemble the complete system instructions, all completed user/assistant turns of this conversation, and the new message. Clients supply the new text, never authoritative history or system instructions.

Do not silently truncate older turns or summarize them. Failed, cancelled, blocked, and interrupted turns remain visible but are excluded as pairs from subsequent model input. Retrying a failed question creates a new turn; do not duplicate the failed user's message in the prompt.

Before acceptance, count Unicode code points across all model-input text. If the configured input bound would be exceeded, do not call the provider or consume a question allowance. Preserve the draft and transcript and return a conversation-length error with a new-chat action. A conversation that has reached its bound remains readable.

The character bound is not an exact model context-window measurement. Handle provider context-limit rejection explicitly. If a fresh conversation cannot fit because of the prompt/current message or model configuration, return an input/configuration error rather than repeatedly suggesting new chat. Output-token budget and provider-specific context constraints also affect whether a model accepts a request.

There is no separate 8,000-character user-message ceiling. The assembled-input bound and bounded HTTP request body both apply. Scope any larger HTTP body allowance to chat routes; retain existing limits elsewhere. Size that allowance to accommodate configured Unicode text and JSON escaping with finite overhead, and test the interaction so the transport does not contradict the advertised message allowance.

## Send Lifecycle, Streaming, And Recovery

1. The SDK stores a session credential, creates a request ID, and presents a pending user message.
2. The API validates the embed and credential, then checks input, allowances, and concurrency.
3. Atomically accept the turn and acquire reservations before contacting the provider.
4. Invoke the configured model with assembled input and stream typed events for acceptance, assistant text, and terminal outcome.
5. Persist assistant output and usage server-side, independent of the browser receiving the final event.

Use server-sent event framing over a POST response consumed through browser fetch, with versioned typed JSON events. Do not use browser EventSource, which does not provide the required POST and authorization-header interface. The SDK owns framing, decoding across network chunk boundaries, event validation, and server-ID reconciliation. Public request/response and stream-event schemas originate in API contracts; generate reusable wire types into the SDK from API-owned artifacts rather than importing app source or copying schemas.

### Idempotency

A UUIDv4 request ID identifies one send in its session. Identical resubmission cannot start another generation or consume another allowance. A duplicate ID with different text is rejected. A completed duplicate can return its recorded outcome; live-stream replay is not required.

The SDK stores each request ID and text until acceptance. After an uncertain response it retries that exact idempotent request, then loads the session with its UUID credential. No special bootstrap secret, credential derivation, recovery endpoint, or cancellation endpoint exists.

After an uncertain network result, reload the accepted turn's state rather than generate again. If still running, use bounded refreshes until terminal. Refreshes do not consume question allowances; general HTTP flood protection remains a deployment concern. There is no second configurable refresh quota in this release.

An explicit retry of a confirmed failed turn is a new attempt and can consume another daily question. Disable automatic SDK and provider generation retries to avoid hidden duplicate consumption.

### Cancellation And Process Failure

Cancellation is an authenticated server operation, not merely aborting the browser fetch. Persist cancellation intent so the process owning a generation can observe it even when a different API instance handles the request. Abort provider work best-effort and retain available output/usage.

Use a bounded generation lease/heartbeat and recovery path so a process crash cannot leave sessions or network concurrency permanently occupied. Internal heartbeat/cleanup intervals are code constants, not deployment knobs. Fence terminal writes so late work from an abandoned attempt cannot overwrite recovery outcomes.

Persist sufficient in-progress output to retain partial replies and produce a fallback usage count on recovery. Batching those writes is an implementation detail; never rely solely on a browser receiving the final event. Idempotent usage recording must finish before exposing successful finalization; interrupted finalization must be recoverable without double counting. Do not pass database transactions across service boundaries to achieve this.

### Errors And Blacklist

Before streaming, use the existing strict RFC 9457 problem-details contract. After headers are sent, use a typed error event with a stable code. Keep raw provider errors, credentials, and internal configuration out of public responses. The SDK exposes codes and structured retry information; the widget localizes messages.

Apply the configured literal, case-insensitive blacklist before emitting output. Buffer enough trailing text to detect matches spanning chunks, including across normalization boundaries. A match stops generation and marks the reply blocked; already emitted safe text cannot be recalled. Test Unicode handling and chunk boundaries. This is literal filtering, not a promise of semantic safety, domain adherence, or prompt-injection immunity.

## Network Allowances And Concurrency

Use one daily accepted-question allowance per agent and normalized client network, shared across that agent's embeds and sessions. The same deployment-configured threshold applies independently to all agents. There is no per-agent limits editor in this milestone and no deployment-wide consumption pool.

- Reset at UTC midnight and expose the reset/retry time to the SDK.
- Apply one active generation per session and a configurable active-generation cap per agent/network.
- No separate per-minute question tier or session-creation quota.
- Session creation consumes the first accepted question atomically; empty sessions cannot be spammed through a dedicated endpoint.
- Invalid requests and duplicate sends do not consume allowance. An accepted new attempt consumes its slot even if generation later fails, is blocked, or is cancelled.
- PostgreSQL counters/reservations are atomic and shared across API instances. Redis is not introduced.
- Clean up expired counters and abandoned reservations, not conversation content.

These controls do not provide HTTP DDoS protection or identify unique people. An attacker with multiple networks can bypass a single-network allowance, while legitimate people sharing a network can exhaust each other's allowance. Document the limitation and phrase errors as network allowances rather than accusations against an individual.

### IPv4, IPv6, And Proxies

Use a maintained IP parser and normalize before keying or hashing:

| Address | Default identity |
| --- | --- |
| IPv4 | Full address, `/32` |
| IPv4-mapped IPv6 | Equivalent IPv4 identity |
| Native IPv6 | Masked `/64` network prefix |

Canonicalize equivalent spellings. A configurable IPv6 prefix length allows operators to choose narrower grouping such as `/128`; enforce a valid integer range of 1 through 128. `/64` reduces temporary-address bypass but can penalize multiple users on the same network. Use identical normalization for daily and concurrency keys.

Trust forwarding metadata only when the connection peer and proxy chain match explicitly configured trusted proxy CIDRs. Resolve the chain from the trusted side, not by blindly taking the first header value. With no trusted proxies, use the actual connection peer. Reject generation if a trustworthy client address cannot be obtained. Never accept a client-selected IP field.

Store a keyed hash of the normalized address/prefix rather than raw IPs in allowance records. Derive a purpose-specific hashing key from the existing application secret; do not add another operator secret. IP-derived data is pseudonymous, not guaranteed anonymous, and must not be treated as a unique-person analytics identifier.

## Usage Accounting

Persist numeric `inputTokens` and `outputTokens` per actual model-call attempt, with agent/conversation/attempt association, provider/model identity, timestamp, and outcome available for later analysis. Do not store `totalTokens`; derive totals by adding the two counts.

Normalize at the model-call boundary:

1. Use valid provider-reported input/output counts when supplied.
2. Derive a missing count from reported totals/components only when semantically unambiguous.
3. Otherwise approximate that missing side as `ceil(unicodeCodePointCount / 4)` over the complete input text sent or output received.

Include system instructions, resent completed history, and current input. Future model-visible retrieval/tool text must join the same accounting path. Count input again on every call. Include cached input exactly once, using provider-adapter normalization; do not subtract cache hits or add them twice. Include reasoning consumption when represented in provider totals, without adding an already-included reasoning breakdown again.

There are no provenance fields, approximation versions, cache breakdown fields, or separate estimated analytics categories. Future analytics sums all stored counts directly. Document once that these statistics can be approximate and are not invoice reconciliation.

Cancelled/interrupted calls without final provider usage use submitted input and output observed by the API. This can undercount unseen output or hidden reasoning; the product explicitly accepts that limitation. An absent output with no observed text yields a zero output approximation, not a claim that the provider did no work. Rejected requests that never invoke the model do not create model usage.

Account idempotently by attempt ID. Receiving a duplicate final event, SDK retry, or recovery action cannot add another usage record for the same call. Persist usage independently of browser connection completion. Agent deletion removes these records deliberately.

## Stateful Browser SDK

The framework-independent SDK has no React dependency; the widget subscribes through React's external-store integration.

Public surface:

```ts
const chat = createChatClient({ apiUrl, embedToken, storage });
chat.subscribe(listener);
chat.getSnapshot();
await chat.initialize();
await chat.sendMessage(text);
await chat.cancelResponse();
await chat.startNewChat();
chat.dispose();
```

- Construction performs no network work. Initialize fetches configuration, including colors, and restores history if a credential exists.
- The snapshot exposes embed configuration, transcript, initialization/generation status, structured error, and retry/reset time.
- Streaming changes the assistant message in the observable snapshot; consumers do not parse events or concatenate chunks.
- Send owns optimistic messages, credential creation, server-ID reconciliation, and at-most-one local active send.
- Server concurrency and authorization still apply; the SDK is not a security boundary.
- New chat cancels active work before detaching from it, clears the selected credential/transcript, and creates no empty server conversation.
- Dispose releases listeners, refresh work, and local connections. It does not erase history or implicitly promise server cancellation.
- Storage is injectable, with local-storage support for the widget and memory-only support for custom consumers.
- The SDK owns recovery, not the widget. No automatic paid regeneration follows a transport failure.

Build a workspace package with declared exports appropriate for eventual public JS/TS distribution. Consume it from the widget. Publishing to npm is a separate explicit action.

## Widget Behavior

The widget owns draft text, focus, scrolling, panel state, resizing, themes, accessibility, and localization. It has no separate transcript store, direct API fetches, session lifecycle, stream parser, or generation retry logic. It renders SDK configuration and may apply supported local presentation overrides.

Provide a New chat button in the chat-panel header beside the existing theme/close controls. An icon button must have a localized accessible name and tooltip. It is available whenever a conversation exists, not only after reaching a length limit; disable it during initialization and while a reset is already pending. Invoke the SDK's `startNewChat()` rather than clearing widget-owned message state. If generation is active, the SDK first requests cancellation. On successful reset, show the initial greeting, preserve any unsent draft, and focus the message input. Keep the current conversation visible and report an error if reset fails. The conversation-length notice exposes the same New chat action. Reset does not delete server history or reset the network allowance, and the initial UI greeting is not added to model history.

| State | UI behavior |
| --- | --- |
| Initializing | Loading feedback; sending unavailable until ready |
| Streaming | Incremental assistant text and cancellation control |
| Daily allowance reached | Network-specific explanation and reset time |
| Concurrent work limit | Preserve draft and explain that another response is running |
| Conversation full | Preserve draft/history and offer new chat |
| Invalid embed/revoked session | Explain lost access; no automatic session-creation loop |
| Failed/cancelled/interrupted/blocked reply | Distinguish partial content from completed messages |
| Storage unavailable | In-memory operation without promising reload recovery |

Preserve the existing visual language, desktop/mobile behavior, and accessibility. Appearance previews must remain non-billable; do not create sessions or invoke a model merely to render a dashboard preview. If no valid embed exists, the widget cannot silently fall back to a working anonymous chat.

## Configuration Policy

Environment variables express deployment policy that operators plausibly need to change. Do not expose every internal detail, and do not introduce competing environment overrides for database-owned product settings.

The [deployment guide](../../apps/docs/content/docs/deployment.mdx) owns the current variable names, defaults, and operator guidance.

Parse in `apps/api/src/config/env.ts`. Reject invalid values at startup. Numeric limits are positive safe integers, additionally constrained where the runtime/provider requires narrower bounds. Parse and validate proxy CIDRs rather than accepting arbitrary strings. Changing network policy can alter allowance keys; document that deployment changes are not a stable identity migration mechanism.

Code constants or derived values:

- One generation per session, UTC reset, credential entropy, approximation divisor, and zero automatic generation retries.
- Versioned protocol event names and SDK internal refresh cadence.
- Lease/heartbeat intervals, cleanup batches, and persistence batching.
- Blacklist look-behind derived from terms and HTTP body bounds derived from accepted content, with finite framing overhead.

Keep constants with their owners rather than adding a global miscellaneous constants file. Agent prompts/blacklists, provider selection/credentials, and embed appearance remain database settings. API URL, embed token, and storage are SDK options. There is no session-expiry environment variable.

## Verification And Acceptance

The milestone is complete only when a real embedded widget and a headless SDK consumer can use the same API to receive streamed, persisted, multi-turn responses from the configured model, with enforced session isolation and network controls.

Required coverage:

- Existing embed configuration/token preservation, obsolete agent token removal, rotation, reassignment, and revoked-session behavior.
- History isolation across sessions and agent attribution independent of later embed changes.
- Atomic first-message acceptance, duplicate-request recovery including lost bootstrap responses, daily counters, and concurrent requests across API instances.
- IPv4, mapped IPv6, equivalent IPv6 spellings, prefix boundaries, trusted proxy chains, and forged headers.
- Full prompt/history propagation, exclusion of incomplete turns, Unicode input/body bounds, conversation-full handling, and provider context rejection.
- Stream event framing, blacklist chunk boundaries, cancellation routed to another API instance, process-failure recovery, and fenced finalization.
- Reported/missing/mixed token counts, cached and reasoning normalization, repeated history, interrupted output, and idempotent usage persistence.
- Agent-deletion confirmation and deletion races; embed deletion and token rotation preserve history/usage.
- SDK snapshots, subscriptions, storage failures, reload restoration, duplicate sends, cancellation, new chat, and disposal.
- Widget rendering and accessible error states on desktop and mobile.
- Header New chat button, keyboard access, active-generation reset, draft preservation, input focus, and the equivalent conversation-length action; verify old server history remains and the network allowance does not reset.
- Browser E2E using real Talqo API/database and an external fake provider extended to stream model responses, not just list models. Seed data remains API-owned and isolated.

## Documentation And Implementation Order

1. Rename configuration ownership to embeds, preserve existing configuration-token embeds, remove agent tokens, and add embed-token rotation.
2. Implement conversation/session/generation persistence, deletion integrity, public contracts, and network enforcement.
3. Connect text generation, streaming, cancellation/recovery, filtering, and durable usage.
4. Implement the stateful SDK and replace widget-owned fetching/chat state with SDK consumption.
5. Complete operator deletion warnings, generated contracts/locales, integration tests, E2E, and public integration documentation.

Update `docs/architecture.md`, the module diagram, ERD, and affected SRS requirements with the implementation. Record durable decisions, including embed identity, session authorization, and cross-owner deletion semantics, in ADRs. Explicitly reconcile older agent-token requirements, deployment-wide token-cap requirements, and the widget/SDK ownership gap with this approved scope rather than leaving contradictory promises.
