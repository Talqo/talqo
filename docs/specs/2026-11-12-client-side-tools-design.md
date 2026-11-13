# Client-side tools, WebSocket chat, and structured history

## Status

Approved. Implementation in progress.

## Goal and scope

Let developers register browser-executed AI SDK tools through `@talqo/sdk`. The agent can call those tools alongside its configured MCP tools. Retain calls and outputs as conversation content, feed them into subsequent model requests, and show named tool activity in live and saved transcripts.

Included:

- Ordinary AI SDK function-tool definitions, with execution owned by the SDK.
- One WebSocket connection per live turn, carrying generation events, client-tool requests/results, and cancellation.
- Ordered message parts as the canonical stored content for both user and assistant messages.
- Persistent tool inputs, outputs, and outcomes for both client-side and server-side tools.
- Inline tool names and statuses in the widget and the dashboard's saved conversation view.
- Migration of existing text messages, generated contracts, SDK documentation, and end-to-end verification.

Excluded:

- Built-in tools, page inspection or control, screenshots, and a Playwright-like tool.
- A dashboard tool registry, operator settings, dynamic tool registration, or a new permission.
- Tool approval workflows, provider-executed tools, streamed tool outputs, and input-streaming hooks.
- Automatic execution replay, resumable live connections, or moving an active generation between API processes.
- Expandable inputs/results in the UI. Persistence and display are separate concerns.
- Turning the dashboard's appearance preview into a live agent chat. It remains an appearance-only preview.

## Current behavior and the changes required

`conversation` owns turn acceptance, generation leases, cancellation, persistence, and usage finalization. `ai-provider` runs AI SDK's multi-step tool loop. `mcp` resolves server-side tools. These owners remain unchanged.

Today, `message.text` stores the transcript. `completedPrompt` reconstructs only completed user/assistant text pairs. MCP results reach later steps within the current AI SDK invocation but do not survive into the next turn. Tool activity is streamed without a durable call identity in the public protocol, and the widget shows only a temporary generic indicator.

This design changes transport and message content, not the enforcement model. Existing embed validity, private conversation credentials, allowances, concurrency reservations, generation leases, blacklist filtering, and usage attribution remain authoritative.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `conversation` | WebSocket application protocol, accepted turns, structured messages, client-tool proxies, pending-call lifecycle, and history selection |
| `ai-provider` | AI SDK invocation, model/tool events, and preserving step boundaries and tool results without knowing where a tool executes |
| `mcp` | MCP connections, enabled tools, existing result bounds, and connection cleanup |
| SDK | Tool definitions, schema conversion and local validation, browser execution, WebSocket transport, observable state, and recovery |
| Widget | Render ordered message content and pass developer-supplied tools into the SDK |
| Dashboard | Render saved conversation parts through its generated API client |

No new module, shared execution framework, tool-call table, database notification listener, or broker is needed. App source never crosses a workspace boundary. API-owned schemas generate the clients' wire types.

## SDK contract

```ts
createChatClient({
	apiUrl,
	embedToken,
	tools: myTools,
})
```

`tools` is an optional name-to-tool record. Existing calls without it remain valid. Register definitions once when constructing the client; the SDK captures the registry for that client's lifetime. There is no second registration API.

Accept ordinary AI SDK `tool(...)` definitions directly. Reuse AI SDK types and schema conversion instead of introducing a Talqo tool builder or a separately maintained schema format.

Supported definition fields:

- Static `description`.
- `inputSchema` in a form supported by AI SDK's schema helpers.
- Required `execute`, using the normal AI SDK input/options signature.
- Optional `outputSchema`, `strict`, and `inputExamples`.
- The ordinary function-tool type discriminator, when present.

Unsupported behavioral fields fail explicitly before dispatching a turn. They are not accepted and silently ignored. This includes approvals, provider tools, context schemas, deferred discovery, custom model-output conversion, and lifecycle/input-streaming callbacks. The accepted subset must be stated in public SDK types and documentation; a tool returned by `tool(...)` must remain usable without casts or redefinition.

The SDK resolves JSON schemas before opening the turn and validates each call against the original local input schema before executing it. This preserves local refinements and transformations that JSON Schema alone cannot represent. If an output schema exists, validate the result before returning it.

`execute` receives a real call ID, the initiating model-message context, and an abort signal. System instructions and server credentials never enter that context. Tool-specific context is undefined in this version; closures provide host-page dependencies.

Results must be a single JSON value. Reject async iterables and values that cannot round-trip as JSON, rather than silently changing them. A developer can return structured objects, arrays, strings, numbers, booleans, or null. Tools execute only through functions already registered locally; server messages never contain executable JavaScript.

Browser definitions and results are untrusted input. They can inform the model but cannot change system instructions, grant API permissions, or mutate any conversation content except the matching pending call. A public embed token is not a privileged tool-registration credential; these tools grant access only to the registering browser's own capabilities.

## Message content and persistence

Keep `conversation`, `message`, and `generation_attempt` as relational records. Replace `message.text` with non-null `message.parts` JSONB. Each message still owns its role, timestamps, generation reference, and outcome.

Use AI SDK message-part representations for the supported content:

- `text` parts for displayed text.
- `step-start` parts for model-step boundaries.
- `dynamic-tool` parts for invocations, inputs, results, and execution states.

Use dynamic tool parts consistently because tool names are configured at runtime. A tool part retains the model-facing name and call ID. Its metadata identifies the execution source, original display name, optional MCP server name, and terminal outcome where the AI SDK state alone cannot distinguish cancellation from failure.

One invocation occupies one part whose state changes from input available to output available or output error. Repeated and parallel calls use distinct IDs, including calls to the same tool. Preserve the ordering of text, tool parts, and steps. Never flatten all assistant text into one block before or after the tool entries.

Parts are message-owned document content, not collections of foreign record IDs. Keeping them in JSONB does not replace a relationship that should be a foreign key. Tool invocations have no independent lifecycle outside their owning message, so a separate table adds no required behavior.

There is one canonical content representation. Plain text for previews, compatibility fields, and usage estimates is derived from text parts. Do not retain an independently writable text column.

### Durable transitions

- Serialize message mutations within a generation so text flushing and parallel tool results cannot overwrite one another.
- Keep bounded text batching. Do not write a whole growing transcript for every token or stream a full message snapshot for every delta.
- Persist a client call before requesting browser execution. Persist its result before allowing the model to continue with that result.
- Record MCP inputs and the bounded outputs actually supplied to the model, not an uncapped response before MCP's existing result handling.
- Fence every generation-owned write with the existing lease and running-state checks.
- Persist terminal message/tool states before reporting completion. Expired-generation recovery marks outstanding calls as interrupted without discarding completed parts.
- Deleting an agent removes parts through existing message cascades. Late results cannot recreate deleted or finalized content.

Inputs and outputs inherit conversation retention and access rules. They can contain private page or business data. They are not transient delivery records and are not cleared after consumption. Never place them in request logs, notification payloads, or diagnostic event fields.

### Model history

Build subsequent provider input with AI SDK's `convertToModelMessages`, preserving tool-call/result pairs and step order. Model-facing tool names remain stable across turns. A stored result remains usable as history even if that tool is no longer registered; reading it never executes the tool again.

Preserve the existing completed-turn policy: only completed user/assistant pairs become subsequent model input. Failed, cancelled, blocked, and interrupted turns remain readable but are excluded as pairs. Incomplete tool parts must never produce unmatched tool calls in model input. This policy does not erase their saved outputs.

Include serialized structured model content in conversation-length checks and fallback token estimates. Tool descriptions and schemas also consume model context and must be bounded. Preserve explicit context-limit errors; do not silently discard older history or summarize tool outputs.

## WebSocket protocol and lifetime

Add a versioned public-chat WebSocket endpoint at `GET /api/chat/{embedToken}/socket`. Each send opens one connection; a turn's generation and pending client calls belong to the API process owning that connection. A terminal event closes it. No idle socket is needed between turns.

HTTP remains responsible for configuration, saved-session recovery, operator history, and cancellation when there is no live connection. The SDK has one normal live transport, WebSocket. It does not silently fall back to SSE when an upgrade fails.

### Frames

The API contract owns discriminated schemas for every frame and the supported message parts. Every frame carries the protocol version. Client and server validate untrusted frames before using them.

Client frames:

- `start`: private conversation credential, request ID, user text, and the tool manifest. Must be the first frame and occurs exactly once per connection.
- `tool-result`: call ID and exactly one success output or failure. The connection supplies turn identity; the caller cannot nominate another conversation or generation.
- `cancel`: stop the current turn, including a start whose acceptance is still pending.

Server frames:

- `accepted`: stable generation and message IDs/timestamps, plus an explicit duplicate/recovery indication when applicable.
- Ordered part creation/updates and indexed text deltas. These update the SDK's canonical message parts without repeated full-transcript snapshots.
- `tool-call`: client execution request containing call ID, original registry name, validated envelope, input, and execution-message context. A transcript update is not itself an execution request.
- `rejected`: pre-acceptance failure with the existing problem code/status and any retry metadata. No conversation allowance has been consumed for a rejected request.
- `terminal` or `error`: accepted turn's final outcome and existing recovery/retry semantics.

Cancellation completes through the turn's terminal event. Frames after a terminal outcome cannot mutate the turn.

The manifest contains only serializable model-facing definitions. Functions, original schema objects, and browser references stay local. Resolve internal names in one combined binding so client tools cannot replace MCP tools. Reject collisions explicitly rather than shadowing a tool or executing a different definition.

### Authentication and deployment

Browsers cannot attach the existing arbitrary Authorization header to a WebSocket handshake. Send the private credential in the first application frame, never a URL, cookie, or subprotocol. Do not accept a generation or execute tools until the conversation service validates that credential, embed, and start input.

The handshake has an explicit public access policy; application authentication remains mandatory. Accept web origins consistent with public embeds, not only the dashboard origin. Validate an incoming Origin as an HTTP(S) origin when present; it is not proof of authority. Do not authenticate with dashboard cookies. CORS middleware is not WebSocket authorization and must not mutate an upgraded response.

Derive the client network from the upgrade request's trusted peer/proxy data, exactly as for current chat acceptance. Keep credentials and raw frames out of logs. Defer the request's wide event until generation work settles so duration and outcome remain meaningful after the upgrade.

Use Bun/Hono's supported WebSocket facilities and Bun's bounded send buffering, payload limits, and ping/pong support. Close slow or oversized connections rather than retaining unbounded buffers. Self-hosted reverse proxies must forward WebSocket upgrades. There is no new service or sticky-session requirement; an established socket already reaches its owning process.

### Proposed fixed bounds

These are protocol limits, not new operator settings:

- At most 8 client tools per turn; registry names must meet the provider-safe 1 to 64 character grammar. Reject a larger registry before opening the socket and reject a larger manifest at the API boundary, before acceptance.
- At most 16 client-tool calls per turn, across all steps and parallel batches. Both SDK and API enforce this budget. Failed calls consume it; duplicate delivery does not execute again or consume another slot. Reject excess calls with an explicit tool error before browser execution, while preserving completed results and allowing the model to finish its response.
- At most 1,000 Unicode code points per description and 128 KiB for the serialized manifest, including schemas/examples.
- At most 256 KiB per tool input or returned result, plus finite frame-envelope overhead. Reject oversize client payloads; do not silently truncate them into a different value. Binary frames are unsupported.
- The start frame must accommodate the existing configured message limit, JSON escaping, the manifest, and finite envelope overhead. A fixed smaller frame ceiling must not contradict the existing Unicode message allowance.
- Bound server execution-context frames by the same conversation-input limit and account for JSON framing.
- Require a start within 10 seconds of upgrade. Browser execution waits share the existing generation timeout and cancellation signal; no new per-tool timeout setting.

Validate result size before SDK submission and again at the API boundary. Keep the existing AI SDK step bound across both tool sources; client tools do not get an extra execution budget.

The registry and call caps bound resource use, not tool authority. A single powerful tool can still be unsafe. Local registration is an explicit capability grant; host developers must enforce authorization and input scope inside tools and must not expose arbitrary code execution or unrestricted privileged actions. These fixed budgets are conservative starting limits, not a claim of measured use-case coverage.

## Execution, interruption, and recovery

1. The SDK resolves/validates definitions, stores the pending request identity, and opens the socket.
2. The API validates the start and atomically accepts the turn through existing allowance, concurrency, and history checks.
3. The API opens MCP tools and binds client tools as ordinary server-side `execute` proxies. AI SDK retains ownership of the multi-step loop.
4. A client proxy records the invocation, requests browser execution, and waits for the matching result through that socket.
5. The SDK verifies registry membership, validates local input, executes once for that call ID, and submits its bounded result or failure.
6. The API validates the result against its pending call, persists the transition, resolves the proxy, and lets AI SDK continue.
7. The API finalizes content and usage, sends a terminal outcome, and closes the connection.

Ordinary tool failures become tool-error parts/results so the model can respond or use other tools. Invalid protocol state, connection loss during browser execution, or an exceeded deadline cannot leave a proxy waiting indefinitely.

Persisted parts and execution requests are distinct. Loading history, reconnecting, rendering a part, and receiving duplicate delivery must not execute a tool. Maintain an in-memory per-turn record of dispatched calls and accepted results. Repeated identical results do not complete a call twice; conflicting results or unknown call IDs are rejected. Ignore/fence late completion after cancellation or finalization.

Request idempotency covers the user text and tool manifest, not text alone. Store the client-manifest fingerprint on the generation attempt, with no client-tool fingerprint for a server-only turn. Reuse of a request ID with a different manifest is a conflict, not permission to change an accepted generation's capabilities. Functions are not fingerprinted or stored server-side.

Disconnect behavior:

- A turn advertising client tools is connection-bound. Disconnect interrupts the generation and outstanding calls, aborts local SDK work when observable, and never automatically replays them.
- A server-only turn retains current behavior: disconnect may leave generation running, and the SDK recovers its persisted state through HTTP.
- A disconnect after a page action but before result delivery has an uncertain execution outcome. Persist interruption, not a fabricated success or proof that the action did not happen. Aborting a function cannot undo completed side effects.
- Duplicate request IDs direct the SDK to stored-session recovery, never to a second generation or a replay of browser actions. If an already accepted browser-capable request lost its original connection, it is interrupted, not attached to the new socket.
- An uncertain pre-acceptance send cannot be automatically resubmitted with a new request ID. Preserve existing idempotent recovery guarantees.

Persist whether a pending SDK send advertised browser tools alongside its request identity. Such sends recover by observing server state, not by resubmitting a start after reload or connection loss. The browser cannot persist executable definitions or prove whether an earlier page action happened. Existing exact-request resubmission remains limited to server-only pending sends. Handle a not-yet-visible acceptance as uncertain, not as proof that generation or execution never occurred.

Stop signals the server through the active socket and aborts browser handlers. The SDK's stream reader must remain able to process cancellation/terminal frames while an `execute` promise is pending. Reset and disposal clean up all controllers, listeners, pending promises, and sockets. A saved-session recovery without a live socket can still use the existing authenticated HTTP cancel route.

Retries of a turn in which a browser tool was dispatched are not automatically offered as a safe recovery action. A new user instruction can start another turn, but the UI must not imply that repeating a potentially applied page action is harmless. Developer tools remain responsible for authorization and side-effect safety in the host page.

## Transcript behavior

The SDK exposes ordered parts with stable message/call identities. A derived plain-text value may remain for compatibility with existing consumers, but parts determine rendering and history.

The widget and saved conversation view render text and tool entries in order. A tool entry shows its display name, source, optional server name, and running/completed/failed/cancelled/interrupted status. Use plain-language labels such as website tool and connected tool rather than requiring operators to understand execution internals. Use localized status text and accessible status feedback; do not announce every streamed token or expose raw payloads as tooltips.

Completed calls remain visible after the answer, reload, cancellation, and failure. Identical names do not merge separate calls. Inputs/results are retained but not rendered as expandable content in this change.

The pre-built widget forwards programmatic `tools` through its existing mount options into the SDK. It does not execute tools itself. Custom SDK UIs use the same state and execution path. Script-only embeds with no tools continue working with no additional configuration.

The dashboard's saved conversation view uses its generated contract, not SDK execution code. The embed appearance preview remains non-executing and cannot gain access to the parent dashboard's page through a tool bridge.

## Migration and compatibility

Use one generated Drizzle migration containing schema and data changes:

1. Add `message.parts`.
2. Convert each existing text into a text part, using an empty parts array for an empty message.
3. Require non-null parts and remove the writable text column.

The same migration adds the nullable client-manifest fingerprint to `generation_attempt`. Existing attempts are server-only and therefore need no fingerprint backfill.

Preserve IDs, roles, timestamps, generation outcomes, history revisions, and deletion relationships. Update seeds, preview queries, recovery estimates, and all message writers/readers. Existing tool payloads cannot be backfilled because they were never retained. The migration and application version must roll out together; an older API binary cannot write the new schema.

This spec proposes retaining the existing POST/SSE endpoint for server-only direct API consumers. It calls the same conversation service and gains structured persistence, but it does not advertise client tools. This avoids silently removing a public API while making WebSocket the SDK's only normal live path. There is no SSE-based client-tool result mechanism or automatic transport fallback.

HTTP session/transcript responses add parts while retaining derived text where existing consumers expect it. The new SDK exposes parts and documents any source changes required for custom transport implementations. Do not duplicate canonical content to avoid updating fixtures or generated clients.

The API owns frame and message-part schemas. Export their protocol definitions through the existing contract-generation pipeline alongside the upgrade endpoint, clearly identifying post-upgrade messages rather than pretending they are ordinary HTTP response bodies. Generate `apps/api/openapi.json`, the web client, and SDK wire types together. Neither consumer imports API implementation source or hand-maintains a competing wire contract.

Update `docs/architecture.md`, affected `AGENTS.md` transport instructions, and inaccurate SRS/ERD entries with implementation. Public docs explain registration, supported AI SDK fields, retained data, interruption behavior, and WebSocket proxy requirements. Do not document unshipped built-in tools or rewrite old specs as if their historical decisions never existed.

## Implementation plan

1. Add canonical message parts, the migration, derived text queries, and AI SDK history reconstruction. Protect retention, ordering, completed-turn selection, and existing text migration with focused tests.
2. Extend provider events to preserve tool inputs/outputs and step boundaries for MCP. Persist transitions through the existing conversation owner and lease fencing.
3. Add the versioned WebSocket contract and runtime, including first-frame authentication, per-turn pending calls, cancellation, bounds, duplicate handling, and direct-HTTP compatibility.
4. Add SDK tool registration/local validation and the WebSocket live transport. Preserve observable session state, storage fallback, and HTTP recovery; update generated clients in the same change.
5. Pass widget tools into the SDK and render ordered tool entries in live/saved transcripts. Update affected translations without adding payload-inspection controls.
6. Finish architecture/public documentation and verify the complete browser-to-model-to-browser round trip. Ship no built-in tools; use test-only definitions for verification.

## Verification and acceptance

Extend existing tests where they already protect the contract rather than duplicating their scenarios at every layer.

- SDK tests cover real AI SDK tool definitions, typed input inference, local schema validation/transforms, output validation, unsupported definitions, JSON/size failures, distinct call IDs, and cancellation while execution is pending. Verify the 8-tool registry boundary and 16-call execution boundary, including repeated calls to one tool, parallel batches, failures, and duplicate delivery.
- Service/database integration tests cover ordered persisted parts, MCP and client outputs in the next completed-turn prompt, no unmatched tool messages, lease fencing, retention after interruption, duplicate/conflicting results, and cascade cleanup. Use real PostgreSQL; there is no notification-delivery behavior to simulate.
- Socket boundary tests use real upgrades/frames to cover unauthenticated starts, malformed/oversized data, wrong-state frames, deadlines, backpressure/disconnect cleanup, and safe problem-code mapping. Verify that direct callers bypassing the SDK cannot exceed the registry or execution budgets. Keep credentials out of URLs and logs.
- Browser journeys use the real SDK, widget, API, and database with only external providers controlled. Verify a test-only browser tool reads host-page data, the agent uses its result, both tool sources appear in the live transcript, and an operator sees the same entries after reload. A forced disconnect must not execute the browser tool twice.
- Compatibility tests retain server-only HTTP behavior, existing Unicode message capacity, disabled/revoked embed checks, allowance/concurrency enforcement, text-only history migration, and server-only recovery.

Run focused checks first, then the applicable repository gates: `bun run quality:fix`, `bun run typecheck`, `bun run test`, `bun run test:integration`, `bun run contracts:check`, `bun run e2e`, and `bun run i18n:fix`. If generated contracts change, compare regenerated output with the intended checked-in artifacts rather than treating a dirty working tree as proof of generator failure.

The feature is complete only when both tool sources share structured history, the next model turn receives stored outputs, the two transcript views agree, and interruption never triggers automatic browser-action replay.
