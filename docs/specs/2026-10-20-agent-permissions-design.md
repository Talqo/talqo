# Agent permissions

Status: Approved (2026-10-20).

## Outcome

Operators belong to roles. Each role receives explicit permissions on individual agents. Operators configure these permissions on the agent's existing configuration page, immediately above its deletion danger zone.

Replace global agent permissions outright. There is no compatibility layer, automatic backfill, ownership exception, all-agents grant, inheritance, deny rule, role ordering, or direct operator grant. Admin always has full access and is the only operator who can create agents.

## Permission model

Global role permissions remain `users:read`, `users:manage`, `roles:manage`, and `ai_provider:manage`. The existing admin grant remains separate and cannot be assigned through roles. There is no `agents:create` permission.

Per-agent permissions are:

- `stats:read`, displayed as "View statistics". Allows this agent's analytics, without transcripts or configuration.
- `conversations:read`, displayed as "Read conversations". Allows this agent's conversation list and transcripts, without configuration.
- `agents:read`, displayed as "View configuration". Allows reading instructions, blacklist, knowledge files, MCP connections, and embeds.
- `agents:manage`, displayed as "Edit configuration". Includes `agents:read`. Allows configuration changes, knowledge uploads and removal, MCP connection operations, and embed creation, editing, deletion, token rotation, and enabling/disabling.
- `agents:delete`, displayed as "Delete agent". Includes `agents:read`. Allows deletion subject to existing deletion invariants and confirmation. Does not grant editing or transcript access.

Remove the current implications from conversation reading to configuration reading and from admin to an enumerated global agent permission list. Admin instead satisfies both global and agent-scoped authorization directly.

Any agent permission makes its ID and name available to the relevant dashboard sections. Agent discovery returns summaries and effective permissions, not system prompts or other configuration. The Agents sidebar entry, list, and individual configuration pages require `agents:read`. Statistics-only and conversation-only operators use Dashboard and Conversations instead, without fetching configuration. Agent deletion includes viewing so its confirmation is reachable on the configuration page.

The agent page checks its effective permissions before fetching configuration. Without configuration viewing, redirect away without mounting protected queries. Without editing, show selectable read-only text, allow inspection of tabs and downloads, disable state-changing switches, and hide mutation controls. The heading is the agent's name. Show access management and the deletion danger zone only with their respective permissions. Do not add statistics or conversation shortcuts to this page.

Permissions from all assigned roles combine additively for the same agent. Permissions never cross agent boundaries. Editing does not imply statistics, transcripts, deletion, or access administration.

### Trust boundary

MCP creation, including command-based connections, is available to operators with `agents:manage` on that agent. There is no separate admin requirement. This deliberately trusts editors with server-side command execution; agent permissions are not a host sandbox or a guarantee against a malicious editor extracting data through tools or changed instructions.

Operator grants do not change public embed tokens or chat-session authentication. The widget, dashboard chat preview, and custom SDK UIs continue using the same public-chat rules. Configuration viewers can use the existing preview without gaining access to retained visitor transcripts.

## Storage and ownership

The `roles` module owns a new `role_agent_permission` table:

- `role_id`, foreign key to `role`, cascading on deletion.
- `agent_id`, foreign key to `agent`, cascading on deletion.
- `permission`, restricted to the per-agent catalog.
- Composite primary key over all three columns and an index supporting agent-first queries.

There is no separate role-agent membership table. A role has access when at least one permission row exists. Store independent grants; normalize away explicit `agents:read` when editing or deletion already supplies it.

`role_permission` holds only global permissions. Delete its old agent and conversation permission rows in a new migration without converting them. Existing non-admin operators lose those global capabilities until admin assigns explicit agent grants. Preserve unrelated roles, memberships, global permissions, and business data. Development and E2E seeds explicitly create their intended scoped grants.

Use one new migration for both the schema and permission-row removal. Generate the schema SQL and metadata through Drizzle, then include the deliberate data SQL in that unapplied migration. Do not rewrite shared migrations or hand-edit generated metadata.

Keep authorization in `roles.service.ts`. Other modules consume its service API, never its repository or schema at runtime. The roles module may reference the agent schema for its foreign key, but must not import the agent service. Database constraints validate agent existence for grant writes and map violations to domain errors. This avoids an agent-to-roles-to-agent service cycle.

## Access administration

Changing an agent's grants requires all of:

1. Global `roles:manage`.
2. Effective `agents:read` on that agent.
3. Every effective permission being added or removed on that same agent.

Admin bypasses these limits. Editing agent configuration alone never permits changing access. Access managers can preserve existing grants above their authority but cannot change or remove them. Compare effective permissions before and after a proposed replacement, including implications, so normalization cannot bypass the checks.

Apply the same authority bounds to every alternate management path:

- Adding or removing an operator's role checks that role's global permissions and all its agent-scoped permissions.
- Deleting a role checks all global and agent permissions it removes.
- Password reset and operator deletion check the target's effective global and agent permissions. Otherwise resetting a more privileged account's password could bypass grant limits.
- User-list management availability reflects these full checks, not just global permissions.

Reuse the existing deployment-wide access-management lock for fresh checks and writes. Do not cache authorization or introduce another lock protocol. Every role, assignment, grant, password-reset, and user-deletion mutation participates. Replace one role's permission set for one agent in a database transaction so readers never observe partial replacement. A non-admin change can revoke the caller's own access if authorized before the write; subsequent requests must respect the result.

Ordinary resource requests use fresh request-time authorization, matching current semantics. In-flight requests are not cancelled on revocation. The next request must see the new access.

## HTTP and service boundaries

Contracts remain the source of route authorization. Extend `http/access.ts` with explicit agent-scoped policies rather than checking permissions in handlers. Global permission, agent permission, visible-agent discovery, and filtered collection policies remain distinguishable and fail closed.

The roles service exposes global permissions, effective permissions for an agent, agent scopes for a requested capability, and bounded grant management. Keep this domain-specific; do not introduce a generic policy engine. Actor-aware operator service operations enforce the same scope when called without HTTP. Internal public-chat and ingestion operations retain explicit internal service entry points and must not pretend to be an operator.

Proposed endpoints:

- `GET /agents`: visible agent summaries with effective agent permissions. No configuration fields.
- `GET /me/permissions`: global permissions only. Update consumers rather than retaining the old response semantics for agent access.
- `GET /agents/{agentId}/access`: the caller's effective permissions, available when the agent is visible. Include roles and their explicit grants only when the caller holds `roles:manage` and scoped `agents:read`.
- `PUT /agents/{agentId}/access/{roleId}`: atomically replace this role's grants on this agent. Requires at least one effective permission; empty sets use removal instead.
- `DELETE /agents/{agentId}/access/{roleId}`: remove this role's grants immediately after authorization. Does not delete the role.

The roles module owns access-management contracts and routes, composed at these paths by the application. Reads return only information needed for this agent. Do not expose other agents' grants to populate its picker.

Use the visible-agent summary query for sidebar capability checks and agent pickers. Do not request permissions separately for every listed agent. The access endpoint supports direct agent URLs without first loading the entire list. Admin status comes from global permissions, including when the agent list is empty.

Authentication failures remain 401. Missing capability on a visible agent is 403. A resource outside the caller's visible agents returns the same 404 as a nonexistent resource. Filter collection data before pagination, counts, and aggregation. Use existing RFC 9457 error handling; unknown permissions and duplicate request entries fail validation.

Generate OpenAPI and both consumer artifacts from the source contracts. Do not hand-edit generated clients or preserve deprecated contract shapes.

## Every affected resource

- Agent creation requires admin. New agents have no role grants; admin can assign access afterward.
- Agent configuration and deletion use their separate scoped capabilities. Preserve the current attached-embed deletion restriction and dependent cleanup.
- Knowledge file listing, download, and reads require configuration viewing. Upload, retry, change, and removal require editing.
- MCP reads require configuration viewing. Creation, update, deletion, discovery, and connection actions require editing. Resolve nested resources to their owning agent before authorizing.
- Embed reads require configuration viewing. Mutations require editing. Reassigning an embed requires editing on both its current and destination agents, including a fresh check of the persisted source. Public embed configuration reads remain public.
- Operator conversation lists and transcript reads require `conversations:read` on the conversation's stored agent. Do not derive transcript authority from an embed's current assignment.
- Statistics use only agents with `stats:read`. Filter all totals, daily series, active counts, usage, agent names, and filter choices before aggregation. An explicit unauthorized agent filter cannot broaden access.
- Dashboard navigation, lists, filters, and direct URLs follow effective scopes. An empty scope means no results or an access-denied state, never an omitted database filter that means all agents.

## Access section

### Dashboard sidebar

Show Dashboard when the operator has `stats:read` on at least one agent. Show Conversations when the operator has `conversations:read` on at least one agent. Access to an agent without the corresponding capability does not expose either section. These checks depend on permissions, not whether statistics or conversations already exist.

Show Agents when the operator has `agents:read` on at least one agent, and list only agents with that permission. Admin always sees Dashboard, Conversations, and Agents, including when no agents exist. Keep Users and AI configuration governed by their global permissions, and Account available to every signed-in operator. Apply the same visibility rules to desktop and mobile navigation.

Direct URLs enforce the same requirements. After sign-in or loss of the current section's access, navigate to the first permitted sidebar destination, falling back to Account. Refresh navigation after access changes without retaining protected content. Navigation visibility is not a substitute for API authorization.

Do not add push updates or permission polling. Revalidate access on navigation and window focus using the existing query infrastructure. If a protected request reports lost access or a missing resource, discard its protected cached data and refresh the access summary before choosing a permitted destination. A sidebar cached in another browser can remain visible until revalidation; it never authorizes the next API request. Query failures show a retry state rather than treating an unknown permission set as either full access or confirmed denial.

### Role permission editor

Place Access inside the existing Configuration tab, immediately above the deletion danger zone. Do not create an Access tab. Show the section only to operators with global role management and scoped configuration viewing, including admin.

The section contains a keyboard-accessible list of assigned roles, an "Add role" control with a plus icon, and one selected role's permission switches below. Match the Roles editor's divided rows, descriptions, and right-aligned switches. The selected role provides visible context; identify it in a screen-reader-only fieldset legend rather than repeating it as a heading. Do not render every role's permissions in the list or an admin access notice. Align Save to the right and keep removal separate on the left.

Adding a role opens its empty draft. Exclude roles already assigned or already drafted from the picker. Nothing is granted until Save succeeds. Save applies the selected role only. Switching roles preserves drafts locally; leaving the page with dirty drafts offers discard confirmation. Show the implied viewing permission when editing is selected and prevent contradictory switch states.

Save requires at least one selected permission. With none selected, a new draft cannot be saved; an existing assignment directs the operator to Remove role access. This keeps permission changes from silently invoking the immediate-removal operation.

Place "Remove role access" beside Save for persisted assignments. Confirm in plain language that members lose this role's access to this agent, but may retain access through other roles. Confirmation sends DELETE immediately, independently of Save. After success, remove that role and its draft from the section. Cancelling or a failed request preserves the draft and saved state. Unsaved additions have Cancel rather than a destructive removal action.

Recovery uses the existing Add role flow to grant access again, subject to fresh authorization. Do not add a separate undo protocol. After self-revocation, clear protected cached content and navigate to an accessible page; recovery requires another authorized operator or admin.

Disable permission changes outside the caller's authority. Remove is unavailable if any removed permission exceeds their authority. Save and Remove are mutually exclusive while a mutation for that assignment is pending, so a delayed Save cannot recreate access just removed in the same editor. Keep operation-specific feedback, inline recoverable errors, focus handling, accessible labels, and empty/loading states. Refresh effective access after each successful mutation. Do not add permanent explanatory paragraphs about permission combination; explain it contextually when needed, including removal confirmation.

The existing role editor manages names and global permissions only. Agent access is edited in the agent section. Do not add a second grant editor or an effective-access inspection feature in this change.

## Implementation plan

1. Add the scoped catalog, schema, migration, roles service operations, authority checks, and deterministic seed grants. Remove global agent permissions and their obsolete implications.
2. Add scoped contract policies and collection filtering. Update agent summaries and effective-access contracts. Enforce every affected service and resource boundary, including role membership, password resets, and deletion.
3. Regenerate OpenAPI, dashboard client, and SDK wire artifacts. Replace global dashboard agent checks with scoped capabilities, including analytics, conversation filters, and cache invalidation.
4. Build the Access section and separate deletion authority from editing. Add all translated keys in every dashboard locale.
5. Update `docs/architecture.md`, applicable AGENTS instructions, ERD, SRS, and public role/agent documentation made inaccurate by the change. Record the choice of scoped grants over role-agent membership and Discord-style overrides in a concise ADR with the implementation. Do not rewrite accepted ADR history.
6. Complete focused tests, then required project verification. Remove obsolete tests and helpers rather than retaining compatibility branches.

## Verification and acceptance

Use pure tests for implication expansion, scoped union, and authority comparisons where useful. Use service-facing integration tests against PostgreSQL for the actual authorization and persistence boundaries:

- One role edits Agent A and only views Agent B. Another role adds conversation access on A without leaking editing to B.
- Statistics-only and conversation-only operators receive names and permitted content, not configuration. Editors do not automatically receive transcripts, analytics, or deletion.
- Admin creates agents; non-admin creation fails. New agents have no inherited grants.
- Grants, removals, role assignments, role deletion, password resets, and user deletion cannot exceed the caller's global or scoped authority. Check both sides of implications, including replacing editing with viewing. Concurrent management writes cannot authorize against stale grants. Self-revocation applies on the next request.
- Direct IDs, nested resource IDs, embed reassignment, transcript reads, pagination, empty scopes, and analytics aggregates do not bypass agent boundaries. Public chat behavior remains unchanged.
- Role replacement is atomic, deletion cascades remove grants, invalid input fails, and re-adding a removed role uses fresh authorization.

Component tests cover selected-role editing, drafts across selection changes, implication controls, empty selections, selected-role Save, immediate confirmed removal, mutually exclusive mutations, failed mutations, re-adding a role, and inaccessible actions. Verify that reporting-only operators cannot enter configuration pages and that read-only operators can inspect but not change settings. Navigation tests cover each capability independently, no accessible agents, agents without activity, admin with no agents, query errors, and landing-page fallback. E2E covers admin assigning access through the new section, a restricted operator seeing and using only their allowed dashboard sections, and revocation denying their next request and updating navigation on revalidation. Reuse existing journey setup and mock external providers only at their boundaries.

Run focused checks first, followed by `bun run quality:fix`, `bun run typecheck`, `bun run test`, `bun run test:integration`, `bun run e2e`, `bun run contracts:check`, and `bun run i18n:fix`. Run `bun run actions:check` only if workflows change. Inspect the final diff for compatibility branches, redundant checks, and accidental unrelated edits.
