# Plan: Widget Disable + Statistics Dashboard (two branches, two Agent Manager worktrees)

## Execution model

Two independent features, each implemented on its own branch in its own Agent Manager git worktree by a separate agent. Started via `agent_manager` (mode `worktree`) after this plan is approved:

| Session | Branch | Task |
| --- | --- | --- |
| "Widget disable" | `feat/embed-widget-disable` | Task 1 |
| "Stats dashboard" | `feat/dashboard-statistics` | Task 2 |

Model/provider: inherit current turn (no override requested).
Merge strategy note: both branches regenerate `apps/api/openapi.json` and `apps/web/src/api/generated` and touch web locales, so they must be merged sequentially; the second branch rebases and re-runs `bun run contracts:generate`.

Each agent's acceptance run:

```sh
bun run quality:fix && bun run typecheck && bun run test && bun run test:integration
bun run contracts:check
bun run i18n:fix        # locales change in both tasks
bun run e2e             # e2e specs added/updated in both tasks
```

---

## Task 1 — Operator can disable the widget (`feat/embed-widget-disable`)

Today: `embed` has no enabled/disabled concept at all — schema, public config, and conversation acceptance never check one (verified by codebase research).

### API (`apps/api`, module `embed` + `conversation`)

1. **Schema/migration**: add `isDisabled` boolean `notNull default false` to `embed.schema.ts` (closed-column convention). Generate migration centrally (drizzle), inspect SQL, never hand-edit.
2. **Service/repository**: expose `isDisabled` on the `Embed` domain type; add service operations `disableEmbed(id)` / `enableEmbed(id)` (patch through repository; do **not** bump `accessVersion` — we do not intend to kill live sessions silently; flag enforcement is at acceptance).
3. **Contract/routes**: two targeted routes mirroring the `rotateEmbedTokenRoute` precedent: `POST /api/embeds/{embedId}/disable` and `POST /api/embeds/{embedId}/enable`. Include `isDisabled` in `embedResponseSchema` / detail response.
4. **Permission**: gate on the existing `agents:manage` permission (embeds already route all writes through it — no new permission strings). The "non-operator" test case = authenticated user without `agents:manage` → 403 `PERMISSION_DENIED`.
5. **Public surface**: include `isDisabled` in `EmbedConfig` (`embedConfigResponseSchema`, ETag-cached config) so already-shipped widgets learn the state.
6. **Conversation acceptance**: extend the single documented row-locked embed read inside `acceptGenerationAttempt` (the recorded architecture exception) to reject a disabled embed with a new API-owned problem code, e.g. `embed-disabled` → 403. No new cross-module access beyond that exception.
7. Regenerate contracts: `bun run contracts:generate` (openapi.json + orval web/sdk output).

### Web (`apps/web`)

8. Embed detail page `routes/dashboard/embeds/$embedId.tsx`: add Disable/Enable button (e.g. next to Rotate token), with a confirmation dialog for disable. Render **only when `canManage`** (`useGetMyPermissions()` + `permissions.includes("agents:manage")`) — non-privileged users cannot even see the button (matches existing `RotateEmbedTokenDialog` / `DeleteEmbedDialog` gating).
9. Locales: extend all of `apps/web/src/locales/{en,cs,zh}.json` together with identical key sets (`bun run i18n:fix`).

### Widget (`apps/widget`)

10. When config reports `isDisabled`, render the widget's existing unavailable-style state labelled "chat disabled" (extend widget locales for all its languages); do not attempt to open sessions. Launcher rendering decision (hide vs. greyed) finalized by the implementing agent against existing `unavailable` handling.

### Tests (Task 1 — the requested test coverage)

11. `embed.integration.test.ts`: disable/enable persists via service; public config reports the flag.
12. `conversation` integration/routes coverage: sending a message to a disabled embed is rejected with the new problem code.
13. `embed.routes.test.ts`: disable/enable returns 200 with `agents:manage`, **403 for authenticated user without it** (the explicit "non-operator cannot" test), 401 unauthenticated.
14. `apps/e2e/tests/embeds.spec.ts`: operator (seeded admin) disables the widget from the detail page and the widget/public config reflects it; a read-only user (permission profile created through application boundaries per e2e conventions, cleaned up in scope) **does not see the Disable button**.

---

## Task 2 — Statistics dashboard as post-login landing page (`feat/dashboard-statistics`)

Today: `/dashboard` (post-login landing) is a static welcome + link-card grid (`dashboard/index.tsx`). `/dashboard/analytics` already implements the target UX (metric cards + recharts `AreaChart`) but renders a deterministic mock (`-agent-stats.ts`, marked with `TODO(agent-stats-api)`). Rich real data exists (`conversation`, `message`, `generation_attempt`, `usage_record`) but **no aggregation endpoints** and no generated web hooks for them.

### API (`apps/api`)

1. **Aggregation capabilities**:
   - `conversation.repository`/`conversation.service`: per-day conversation and message counts for an agent or all agents over N days.
   - `usage.service` (+ aggregation in usage repository): per-day input/output token sums.
2. **Endpoint**: `GET /api/stats/overview?days=30&agentId=<optional>`, owned by the `conversation` module (orchestration owner; calls `usage.service` — keeps deps acyclic since `usage` does not depend on `conversation`). Response: totals (conversations, messages, tokens in/out), daily series, per-agent breakdown. Permission: `agents:read` (matches analytics page gate).
3. Contract tag e.g. `"Stats"`; add the tag to the `web` filter in `orval.config.ts` so hooks are generated; run `bun run contracts:generate`.
4. Update `docs/architecture.md` in the same change (new stats capability + orchestration ownership).

### Web (`apps/web`)

5. **Replace** `routes/dashboard/index.tsx` with the statistics dashboard: metric cards (conversations, messages, tokens — 30 days) + recharts daily-series chart + per-agent breakdown (reuse card/chart markup currently in `analytics.tsx`; extract shared components per reuse rules if both pages keep chart logic).
6. **Replace the mock**: `analytics.tsx` switches from `createMockStats` to the real `GET /api/stats/overview?agentId=…`; delete obsolete `routes/dashboard/-agent-stats.ts` (resolves both `TODO(usage-api)` / `TODO(agent-stats-api)` markers; `agents.tsx` placeholder metrics stay out of scope or are wired to the per-agent stats if trivial).
7. Permission handling: no `agents:read` → `AccessDenied` (existing `features/permissions` component), consistent with analytics.
8. Locales: new keys across all three locale JSONs together (`bun run i18n:fix`).

### Tests (Task 2)

9. Integration tests: aggregation correctness (counts/tokens per day, per-agent filter) against isolated test DB; routes test: 403 without `agents:read`.
10. E2E (`apps/e2e/tests/`): journey creates chat data through the real chat boundary (fake-provider pattern from `embed.spec.ts`), then asserts the landing page shows the recorded statistics after login; cleanup in owning scope.

---

## Open decisions left to implementing agents (within these guardrails)

- Exact problem code/HTTP status naming for the disabled rejection (`embed-disabled`, 403).
- Widget presentation of disabled state (existing `unavailable` styling vs. hidden launcher).
- Final response shape of the stats endpoint (must cover the landing cards + daily chart + per-agent breakdown above).
