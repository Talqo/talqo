# Agent Module Design

## Summary

Implement the agent configuration capability as an API module under `apps/api/src/modules/agent/` and replace the dashboard's in-memory agent store with authenticated API-backed state. The first version owns an agent's name, raw system prompt, and word blacklist. It deliberately excludes AI-provider, MCP, knowledge, conversation, rate-limit, public-token, widget-appearance, and analytics behavior.

Agents belong to the single-tenant deployment rather than to individual operator accounts. Operators receive global read or manage permissions; there are no per-agent grants.

## Goals

- Persist agent configuration in PostgreSQL.
- Support listing, creating, reading, updating, and hard-deleting agents.
- Persist each agent's blacklist as a one-to-many relationship.
- Replace mock dashboard agent state with API-backed TanStack Query state.
- Make agent-dependent navigation visible only to operators who can read agents.
- Give future runtime modules a transport-neutral service for reading agent configuration.
- Align the ERD and authorization documentation with deployment-owned agents and global grants.

## Non-Goals

- AI-provider credentials or model selection.
- MCP server configuration or agent-to-MCP assignment.
- Knowledge ingestion, embeddings, or RAG.
- Conversations, messages, response generation, or blacklist enforcement at runtime.
- IP rate limiting or message limits.
- Token-authenticated public endpoints for the widget or SDK (the embed token itself is stored per agent and rotatable here; enforcement lands with those endpoints per FR-3.4/NFR-3.3).
- Widget appearance persistence.
- Agent analytics.
- An active, paused, enabled, or disabled lifecycle state. The current mock status has no defined SRS behavior and will be removed.

## Architecture

The new module follows the existing modular-monolith boundaries:

```text
apps/api/src/modules/agent/
|-- agent.contract.ts
|-- agent.routes.ts
|-- agent.service.ts
|-- agent.repository.ts
|-- agent.schema.ts
|-- agent.seed.ts
|-- agent.test.ts
|-- agent.routes.test.ts
`-- agent.integration.test.ts
```

Each file is included because this implementation needs its capability: HTTP validation, transport adaptation, application behavior, persistence, schema ownership, deterministic E2E data, and tests at each boundary. The API app composes `agentRoutes`. The agent module calls only the roles service for authorization and exposes its own service as the future in-process integration boundary.

Routes validate and translate HTTP concerns. The service enforces normalization and aggregate invariants and returns domain values rather than Drizzle rows. The repository performs only agent-owned persistence. MCP, knowledge, conversation, usage, and AI-provider modules are neither created nor imported.

The roles module receives the minimum cross-cutting changes required by the chosen authorization model: global agent permissions, effective-permission discovery, and removal of obsolete agent-scoping fields. This is an intentional supporting change, not a second business-capability implementation.

## Data Model And Cardinality

### Agent

The `agent` table contains:

- `id`: text primary key containing an application-generated UUID.
- `name`: trimmed display name, required, 1-100 characters.
- `system_prompt`: trimmed raw prompt, required, 1-20,000 characters.
- `embed_token`: UUID with `gen_random_uuid()` default and a unique index, required. Public identifier carried by the embed snippet; rotation replaces it and orphans the previous value.
- `created_at`: timezone-aware creation timestamp.
- `updated_at`: timezone-aware last-update timestamp. Rotation does not touch it — configuration last-changed semantics.

Agent names are unique across the deployment after case folding. PostgreSQL enforces this with a unique index over `lower(name)`. IDs, not names, remain the stable identity.

### Blacklist Word

The `blacklist_word` table contains:

- `id`: text primary key containing an application-generated UUID.
- `agent_id`: required foreign key to `agent.id` with `ON DELETE CASCADE`.
- `word`: trimmed operator-entered term, required, 1-100 characters.
- `created_at`: timezone-aware creation timestamp.

The cardinality is `AGENT 1 -> 0..* BLACKLIST_WORD`: every blacklist row belongs to exactly one agent, while an agent may have no blacklist terms. A unique index over `(agent_id, lower(word))` prevents case-insensitive duplicates per agent. Entered spelling is preserved for display.

An aggregate may contain at most 100 blacklist terms. Create and update replace the complete blacklist in one database transaction, so consumers never observe a partially updated configuration.

### Removed Relationships

The conceptual `USER 1 -> 0..* AGENT` relationship is removed. A deployment is the tenant, and its agents are shared resources governed by RBAC rather than user ownership.

The conceptual `AGENT 1 -> 0..* PERMISSION_GRANT` relationship is also removed. `permission_grant.agent_id` and the corresponding service and HTTP fields are removed because every permission grant is global. A custom data migration first deletes legacy scoped grants so removing the column cannot silently broaden their authority. The following generated schema migration removes the unused column and creates the agent-owned tables and indexes.

`AGENT_IP_RATE_LIMIT` remains a conceptual future capability but is not created in this effort. Its storage and enforcement contract must be designed with the future conversation/public API boundary rather than inferred now.

## Domain API

The service exposes transport-neutral operations:

- `listAgents(): Promise<Agent[]>`
- `getAgent(id: string): Promise<Agent>`
- `createAgent(input: AgentInput): Promise<Agent>`
- `updateAgent(id: string, input: AgentInput): Promise<Agent>`
- `deleteAgent(id: string): Promise<void>`

`Agent` contains `id`, `name`, `systemPrompt`, `wordBlacklist`, `createdAt`, and `updatedAt`. `AgentInput` contains `name`, `systemPrompt`, and `wordBlacklist`.

Input normalization trims names, prompts, and blacklist terms. Empty values are rejected. Blacklist terms are deduplicated case-insensitively while preserving the first spelling. The service reports explicit not-found and duplicate-name errors; transport adapters map them to HTTP responses.

Future conversation code will call `getAgent` to obtain persona and content-policy configuration. It will not query agent tables. Add an implementation TODO at that unavailable conversation integration seam stating that runtime prompt composition and pre-response blacklist enforcement remain required. Blacklist enforcement is direct string comparison against the raw message after trimming, compared case-insensitively — meaning-based matching is out of scope for v1 and the seeded examples must read as literal words an operator wants banned (e.g. competitor brand names). Add equivalent concrete TODOs for audit recording and rate-limit integration, each naming the future owner and removal condition. Do not add speculative placeholder files or interfaces.

## HTTP API

All routes require a valid dashboard session.

| Method | Path | Permission | Behavior |
| --- | --- | --- | --- |
| `GET` | `/api/agents` | `agents:read` | Return all agents ordered case-insensitively by name. |
| `POST` | `/api/agents` | `agents:manage` | Create an aggregate and return `201`. |
| `GET` | `/api/agents/:agentId` | `agents:read` | Return one aggregate or `404`. |
| `PUT` | `/api/agents/:agentId` | `agents:manage` | Replace editable configuration transactionally. |
| `POST` | `/api/agents/:agentId/embed-token/refresh` | `agents:manage` | Rotate the embed token; the old value is orphaned immediately. |
| `DELETE` | `/api/agents/:agentId` | `agents:manage` | Hard-delete the aggregate and return `204`. |
| `GET` | `/api/me/permissions` | authenticated | Return the current operator's effective global permissions. |

Create and update accept:

```json
{
  "name": "Support assistant",
  "systemPrompt": "Answer questions about our product.",
  "wordBlacklist": ["secret term"]
}
```

Agent responses wrap one value as `{ "agent": ... }`; list responses use `{ "agents": [...] }`. The permission response is `{ "permissions": Permission[] }`.

Response behavior is:

- `400` for malformed input or aggregate limits.
- `401` for a missing or invalid session through existing middleware.
- `403` for a missing effective permission.
- `404` for an unknown agent ID.
- `409` for a case-insensitive duplicate agent name.
- `204` after successful deletion.

Unexpected failures use the existing API error path. Repository rows and database details never enter response contracts.

## Authorization

The roles permission registry adds:

- `agents:read`: list and inspect all deployment agents and enter agent-dependent dashboard areas.
- `agents:manage`: create, update, and delete deployment agents; it implies effective read access.

`agents:read` supports read-only operators. A stored `agents:manage` grant also satisfies `agents:read` authorization and causes both permissions to appear in the operator's effective-permissions response; this implication is computed and does not create a second stored grant. Admins continue to pass every authorization check through the existing admin bypass and receive the complete permission registry from `GET /api/me/permissions`. Non-admins receive the distinct effective closure of their current grants.

The opaque session token identifies the operator but contains no roles or permissions. The server reads current authorization state for every protected operation and for `GET /api/me/permissions`, preserving immediate revocation behavior. Browser permission state controls discoverability only and is never an enforcement boundary.

The global effective-permissions route belongs to roles, not identity. This preserves the dependency direction in which roles knows identity while identity remains unaware of roles.

Per-agent scoping was a drafting misunderstanding in ADR-0009, never an enacted product rule; removal is correcting that text rather than reversing a decision. The hand-rolled `can(user, grants, permission)` core is unchanged. Implementation updates ADR-0009, the architecture guide, module diagram, and ERD in the same change.

## Dashboard Design

### Shared Permission State

The dashboard layout owns one TanStack Query for `/api/me/permissions`. It filters both desktop and mobile navigation and the dashboard's shortcut cards:

- Agents, Widget, and Analytics require `agents:read` because each depends on the agent collection.
- Invitations requires `users:invite`.
- Dashboard and Account remain available to every authenticated operator.

Direct navigation does not bypass UX policy. Agent-dependent routes render a clear access-denied state when `agents:read` is absent, and their API requests still return `403`. Manage controls are hidden without `agents:manage`; mutation routes independently reauthorize.

### Agent Collection

`/dashboard/agents` replaces cache-local demo data with the persisted list query. Each agent appears as a clearly clickable card showing its name and a short system-prompt preview. The current active/paused switch is removed.

The page distinguishes loading, retryable failure, access denial, and an empty collection. The empty state explains the resource and shows Create only to managers.

Creation retains the existing dialog pattern. It collects name, raw system prompt, and optional blacklist terms. Submission is disabled while pending, duplicate submissions are prevented, field and server errors appear near the relevant context, and entered values survive failure. Success updates or invalidates the list cache and navigates to the new agent's configuration page.

### Agent Configuration

`/dashboard/agent/$agentId` loads one persisted aggregate. Name and system prompt remain conventional labeled fields.

The blacklist is presented as a one-to-many term editor rather than a comma-encoded text field. It provides:

- One labeled input with Add and Enter behavior.
- Removable term chips.
- Case-insensitive duplicate prevention.
- Current count and maximum feedback.
- Keyboard-operable add and remove actions.
- Accessible names and status/error announcements.

Save is explicit and disabled while pending. Failed saves retain edits. Successful saves announce completion and reconcile list, detail, Widget, and Analytics selectors through shared query invalidation.

A visually separated danger zone performs hard deletion. The confirmation dialog requires the exact current agent name before enabling deletion. Success returns to the collection and invalidates every agent query. If an update or delete reports that the resource was already removed, the UI explains the stale state and returns to the collection.

### Agent Consumers

Widget and Analytics selectors consume the same persisted agent-list query and validated URL selection already used by the dashboard. They receive real agent IDs, names, and embed tokens after reload, and the embed snippet carries the persisted embed token instead of the raw agent ID. Their appearance settings, generated statistics, and non-functional chat preview are not expanded by this effort; concrete TODOs identify the analytics and conversation integrations where the current mock behavior meets the new persisted identity.

The API remains authoritative. Agent mutations are not optimistic because configuration conflicts and failed aggregate transactions must not be presented as saved.

### Responsive And Localized Behavior

The established visual language and shared UI components remain unchanged. On narrow viewports, content preserves task order: identity, prompt, blacklist, then danger zone. Dialogs fit the viewport, blacklist controls remain operable by touch and keyboard, and destructive actions do not compete visually with Save.

All changed and new literal i18n keys are added to every locale owned by `apps/web`, with identical key sets across languages.

## Frontend Ownership

The web API client gains handwritten agent and effective-permission operations until the documented generated OpenAPI client exists. Agent server-state files use operation-specific names under `apps/web/src/features/agents/`, for example list/detail queries and create/update/delete mutations, rather than retaining the current all-in-one mock query file.

Route-only UI remains with its route. Reusable agent-selection and blacklist-editor behavior belongs to the existing agent feature because multiple dashboard routes consume agent state. No product workflow moves into `packages/ui`.

## Error And Concurrency Handling

- Server validation is authoritative; matching client checks exist only for immediate feedback.
- Name conflicts remain deterministic under concurrent creation because PostgreSQL owns the unique constraint.
- Aggregate create and update use transactions. A blacklist failure rolls back the agent change.
- Forms preserve unsaved input after validation, network, conflict, and permission failures.
- Query cancellation and stale responses must not overwrite a later successful mutation.
- A permission revoked while a page is open causes the next API operation to return `403`; the dashboard refreshes effective permissions and removes unavailable navigation/actions.
- Deletion is irreversible in this version and is protected by exact-name confirmation rather than soft-delete complexity.

## Seeds And Migrations

The API-owned `e2e` seed profile creates deterministic environment-named records in an isolated database: one admin, one operator with agent and AI-provider management, one read-only agent viewer, one ungranted member, and one production-plausible agent "Website Assistant". Browser tests read the same environment-defined credentials rather than owning record definitions. Reset ordering respects the blacklist-to-agent foreign key.

Drizzle discovers `agent.schema.ts`. After the custom scoped-grant cleanup migration, it generates the centralized agent schema migration. Generated SQL is inspected for:

- Both new tables.
- Case-insensitive unique indexes.
- Blacklist cascade behavior.
- Removal of `permission_grant.agent_id`.

Generated migration and metadata files are never hand-edited; the cleanup is intentionally created through Drizzle's custom-migration workflow.

## Testing Strategy

### Unit Tests

- Agent input trimming and bounds.
- Case-insensitive blacklist deduplication with first-spelling preservation.
- Maximum blacklist size.
- Mapping repository data to transport-neutral domain values.
- Typed duplicate-name and not-found behavior.
- Global `can` and effective-permission behavior for admins and grantees.
- Blacklist editor add, Enter, duplicate, remove, limit, keyboard, and accessible-announcement behavior.
- Permission-based navigation and action visibility.
- Mutation error preservation and query invalidation.

### Route Tests

- Authentication and `agents:read`/`agents:manage` enforcement on every agent endpoint, including the manage-implies-read rule.
- Effective-permissions response for admin and non-admin sessions.
- Request validation, serialization, status codes, and error mapping.
- Read-only users cannot mutate even if they call endpoints directly.

### Integration Tests

- Aggregate CRUD against PostgreSQL.
- Case-insensitive agent-name uniqueness.
- Case-insensitive per-agent blacklist uniqueness.
- Create/update transaction rollback.
- Deterministic list ordering.
- Blacklist cascade and hard deletion.
- Grant/revoke behavior takes effect without creating a new session.
- Database migration and reset/seed lifecycle.

### End-To-End Tests

Replace the existing cache-local agent journey with a real API-backed journey that verifies:

- Create and configure an agent.
- Reload persistence.
- Blacklist add/remove behavior.
- Agent propagation to Widget and Analytics selectors.
- Exact-name deletion confirmation.
- Deletion persistence after reload.
- Navigation visibility for read, manage, and ungranted operators using API-owned seed identities and grants.

Run the repository-required quality, typecheck, unit, i18n, integration, and E2E commands after implementation.

## Documentation Changes During Implementation

- Update `docs/ERD.md` to remove User-to-Agent and Agent-to-Permission-Grant relationships while retaining Agent-to-Blacklist-Word.
- Update `docs/architecture/module-diagram.md` to describe deployment-owned agents and global grants.
- Update `docs/architecture.md` where authorization boundaries and canonical module structure change.
- Edit ADR-0009 to drop the never-enacted agent-scoping wording while keeping the hand-rolled authorization decision intact.
- Update SRS completion notes only for behavior actually delivered.

## Acceptance Criteria

- Agent configuration persists across browser and process reloads.
- Names are deployment-wide case-insensitively unique.
- An agent contains zero to 100 case-insensitively unique blacklist terms.
- Aggregate updates cannot partially save.
- Operators without `agents:read` cannot discover or access Agents, Widget, or Analytics dashboard areas.
- Operators with `agents:read` but without `agents:manage` can inspect agents but cannot discover or execute mutations.
- Operators with `agents:manage` receive effective read access and can create, update, and hard-delete agents, subject to independent server authorization.
- The dashboard contains no in-memory agent seed or active/paused behavior.
- Widget and Analytics selectors use persisted agent IDs and names without adding runtime, provider, MCP, RAG, appearance, or analytics implementations.
- ERD and architecture documents describe deployment-owned agents and global permissions consistently.
- Required automated checks pass with deterministic API-owned test data.
