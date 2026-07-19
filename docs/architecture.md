# Talqo Architecture

This file is the single canonical internal architecture guide. `apps/docs` owns public product documentation; root `docs` owns internal engineering documentation and ADRs.

Update this guide in the same change as any decision that changes architecture, boundaries, ownership, canonical structure, or the technology roles below. Add or supersede an ADR when the decision is significant and durable.

## System Shape

- Talqo is a modular monolith: one API process and one PostgreSQL database.
- Business capabilities live in modules. A module owns its domain behavior, writes, and schema declarations.
- Modules expose service-based, in-process APIs. Synchronous module dependencies are acyclic by default.
- HTTP routes translate transport concerns and call services; they do not contain business or persistence logic.
- Application composition, database connection setup, and migration generation/application are centralized in the API app.
- The database and API are authoritative. Browser caches, projections, and generated clients are derived.

## Technology Baseline

| Technology or decision | Role | Decision record |
| --- | --- | --- |
| Bun | Runtime and toolchain | [ADR-0001](adr/0001-use-bun.md) |
| Modular monolith | Application structure | [ADR-0002](adr/0002-use-a-modular-monolith.md) |
| PostgreSQL | Authoritative datastore | [ADR-0003](adr/0003-use-postgresql.md) |
| Drizzle | Persistence and migrations | [ADR-0004](adr/0004-use-drizzle-for-relational-persistence.md) |
| OpenAPI | External API contract | [ADR-0005](adr/0005-use-openapi-for-api-contracts.md) |
| TanStack Query | Browser server state | [ADR-0006](adr/0006-use-tanstack-query-for-server-state.md) |
| Hono | HTTP transport | None |
| Zod | Runtime contracts | None |
| React | Web UI | None |
| TanStack Router | Routing and URL state | None |
| Playwright | E2E tests | None |

## Convention Provenance

Conventions have three sources. Preserve upstream conventions unless a documented Talqo rule intentionally narrows them.

| Source | Conventions |
| --- | --- |
| Framework defaults | Root `drizzle/`; Bun `*.test.ts`; TanStack Router route tokens and generated route tree; Playwright config plus `tests/` |
| Common ecosystem | `src/modules`; `config/env.ts`; `db/client.ts`; `src/api/client.ts`; `packages/api-client`; `apps/e2e` |
| Talqo decisions | Services as module APIs; `.contract.ts` HTTP schemas; distributed persistence-only `*.schema.ts`; constrained `config/constants.ts`; optional feature extraction; `apps/e2e` owns browser journeys |

Role suffixes and boundary rules in this document are Talqo conventions, not framework requirements.

## Workspace Dependencies

The allowed compile-time direction is:

```text
apps -> packages
packages -X-> apps
```

- Apps may import packages. Packages never import app source.
- `packages/ui` is presentation-only: neutral components, styles, and presentation helpers. It contains no product workflows, domain rules, API calls, query policy, or app configuration.
- `packages/api-client` is generated transport-only code. It contains no authentication policy, telemetry policy, error presentation, TanStack Query options, or handwritten domain logic.
- Apps do not import one another. Runtime communication crosses an explicit protocol boundary.
- Package consumers use declared package exports, not package internals.
- `apps/docs` is public documentation. Root `docs` is internal architecture, ADR, and contributor documentation.

## API

```text
apps/api/
|-- drizzle/                         # centralized generated migrations
|-- drizzle.config.ts
`-- src/
    |-- app.ts                       # composition and Hono application
    |-- index.ts                     # process entry point only
    |-- config/
    |   |-- env.ts                   # parsed environment boundary
    |   `-- constants.ts             # optional constrained app constants
    |-- db/
    |   |-- client.ts                # shared connection construction
    |   `-- seed.ts                  # optional environment seed entry point
    |-- http/                         # optional cross-cutting HTTP capabilities
    |-- lib/                          # optional proven non-domain capabilities
    `-- modules/
        `-- project/
            |-- project.contract.ts  # optional HTTP schemas and metadata
            |-- project.routes.ts    # optional HTTP adapter
            |-- project.service.ts   # optional module API/application behavior
            |-- project.repository.ts # optional owned persistence operations
            |-- project.schema.ts    # optional owned Drizzle schema
            |-- project.seed.ts      # optional module seed contribution
            |-- project.test.ts      # optional colocated unit test
            |-- project.routes.test.ts
            |-- project.integration.test.ts # optional module/PostgreSQL integration
            `-- test/                 # optional reusable module test support
                |-- fixtures.ts
                `-- builders.ts
```

Every role file and support directory is capability-triggered. Do not create empty `contract`, `routes`, `service`, `repository`, `schema`, `seed`, `http`, `lib`, or `test` placeholders. `app.ts` composes available capabilities; `index.ts` starts the process and contains no application behavior.

### Module Boundaries

- The only application-level import from another module is its service file through `@/modules/<module>/<module>.service.ts`.
- A module without a cross-module capability does not need a service file. Do not add barrels or `public.ts` to simulate an API.
- Services accept and return domain/application values. Hono request, context, response, and middleware types stay in routes and HTTP infrastructure.
- Services never expose Drizzle rows, table objects, query builders, database transactions, or repository types.
- Routes validate and translate HTTP input, call one or more services, and serialize the result. Keep authentication extraction, status/header mapping, and transport errors at this boundary.
- A module writes only its own tables. It may not import another module's repository or mutate another module's tables through the shared client.
- A schema file may reference another module's table only to declare a database foreign key. This schema-only exception does not grant query or write ownership.
- Cross-module read models and reporting queries are explicit exceptions. Name the owner and read purpose; keep them read-only and prevent domain decisions from depending on denormalized reporting behavior.
- Synchronous service dependencies remain acyclic by default. The module that owns the user-visible operation orchestrates calls to other module services.
- Cross-module transactions are not passed through service APIs. If an invariant truly requires atomic writes across owners, record the exception and orchestration owner before implementation.

### Contracts And Routes

- `<module>.contract.ts` owns Zod transport schemas and route/OpenAPI metadata for that module. Domain rules remain in services.
- A schema shared only between one route and its service is not automatically an HTTP contract; keep transport and domain types distinct where their semantics differ.
- Route registration is composed centrally in `app.ts`; modules do not create independent servers.
- HTTP paths may use plural resources even though module directory and file stems are singular.

### Persistence And Migrations

- `<module>.schema.ts` declares only tables, relations, indexes, and database constraints owned by that module. It contains no domain workflow.
- `<module>.repository.ts` contains persistence operations for owned data. Services own authorization, invariants, sequencing, and application errors.
- `src/db/client.ts` owns connection construction and lifecycle. Modules consume the configured client; they do not create pools.
- Drizzle configuration discovers distributed module schemas and emits one ordered application migration history under root `drizzle/`.
- Edit owned schema source, generate migrations centrally, inspect generated SQL, and apply migrations through the centralized lifecycle.
- Never hand-edit Drizzle metadata or an applied/shared migration. Correct it with a new migration. Use Drizzle's supported custom migration workflow when generated SQL cannot express an intentional change.
- Coordinate foreign keys and other changes spanning schema owners. The table owner approves destructive or compatibility-sensitive changes.
- Generated files are reproducible artifacts and are never hand-edited.

### Tests And Data

- `*.test.ts` is Bun's test convention. Keep a unit test beside the service or pure code it verifies.
- `*.routes.test.ts` verifies HTTP validation, status/headers, serialization, and service integration through the composed app.
- `<module>.integration.test.ts` verifies module behavior that crosses service, repository, and real PostgreSQL boundaries. Use a narrower `<module>.repository.integration.test.ts` only when the repository itself is the subject. The `.test.ts` suffix is required for Bun discovery; do not name tests `<module>.integration.ts`.
- `test/fixtures.ts` contains reusable static test values; `test/builders.ts` creates variable test objects. Create either only after repeated use inside the module.
- Seeds create deterministic environment or demonstration data through API-owned lifecycle entry points. Fixtures and builders create test-scoped values. Do not use production/demo seeds as test fixtures.
- Playwright E2E specs live in `apps/e2e/tests/*.spec.ts` and verify only critical journeys across the real web app, API, and PostgreSQL. Their complete lifecycle is defined in [E2E Tests](#e2e-tests).
- E2E data is a separate deterministic API-owned seed profile applied to an isolated database before each isolation scope; Playwright contains no record definitions or browser fixture datasets.
- Keep test setup closest to its owner. Do not create global `test-data`, `support`, `helpers`, or `utils` buckets.

## Shared Code Decisions

Apply these rules in order:

1. Keep code local while one owner and one use are clear.
2. Call the owning module service when behavior expresses domain rules; do not extract those rules into a shared helper.
3. Extract only when current callers reuse the same semantics, not merely similar syntax or speculative future behavior.
4. Give extracted code a named capability and owner, such as `http/request-id.ts`; never create unrestricted `common`, `shared`, `helpers`, or `utils` buckets.
5. Create a package only when reuse across workspace apps is measured and the API is stable enough to own independently.

`packages/ui/src/lib/utils.ts` is the narrow exception justified by the shadcn component-generation convention. It must remain presentation-only and is not precedent for generic utility buckets.

`config/constants.ts` is optional and limited to environment-independent, application-wide immutable values. Environment values belong in validated `config/env.ts`; domain values belong in their owning module; presentation values belong with their UI owner. Do not turn constants into indirect configuration or a miscellaneous export file.

## OpenAPI And Client

The flow is one-way and deterministic:

```text
module contracts + route metadata
  -> API-owned OpenAPI document
  -> generated packages/api-client
  -> apps/web configured client
  -> route/feature-owned TanStack Query policy
```

- Runtime validation and route metadata originate in module contracts. API composition emits one deterministic API-owned OpenAPI document.
- Select and pin the generator before documenting artifact paths or generated file layout. Preserve the selected generator's output structure rather than wrapping or reorganizing generated files.
- Consumers never import `apps/api` source and never duplicate transport contracts.
- `packages/api-client` is generated transport only. Generated files are never hand-edited.
- `apps/web/src/api/client.ts` configures base URL, authentication, telemetry, request behavior, and app-level error translation. Optional `errors.ts` defines web-facing transport error normalization.
- Generated code contains no TanStack Query keys, caching, retries, invalidation, optimistic updates, or UI error policy. The consuming route or extracted frontend feature owns that policy.

## Web

```text
apps/web/src/
|-- main.tsx
|-- router.tsx
|-- routeTree.gen.ts                 # generated; never hand-edit
|-- api/
|   |-- client.ts
|   `-- errors.ts                    # optional
|-- routes/
|   |-- __root.tsx
|   `-- _authenticated/
|       |-- route.tsx                # pathless authenticated layout
|       |-- account.settings.tsx     # dot notation for a shallow route
|       `-- projects/
|           |-- route.tsx            # directory route/layout
|           |-- index.tsx            # index route
|           `-- $projectId/
|               |-- route.tsx        # dynamic route
|               |-- -project-query.ts
|               |-- -update-project-mutation.ts
|               `-- -project-settings-form.ts
`-- features/                         # optional after proven reuse
    `-- project-settings/
        |-- project-query.ts
        |-- update-project-mutation.ts
        `-- project-settings-form.ts
```

- Follow official TanStack Router tokens: `__root`, leading `_` pathless layouts, `route.tsx` directory routes, `index`, `$param`, dot-delimited nesting, and leading `-` route exclusion.
- Use dot notation for shallow routes that need no colocated support. Use a directory when a route owns a layout, child routes, or operation-specific support files. Do not represent the same route with both styles.
- A route owns its loader, component, validated search schema, and operation-specific query, mutation, and form files while those files have one route consumer.
- Every query, mutation, form, and UI workflow has exactly one source owner. If several routes reuse the same semantics, move the files into `features/<feature>` and delete the route-owned copies in the same change.
- Feature extraction is optional and reuse-triggered. Frontend features model user workflows and do not mirror API modules mechanically.
- Use operation-specific names such as `project-query.ts`, `update-project-mutation.ts`, and `project-settings-form.ts`, not `queries.ts`, `mutations.ts`, or `forms.ts` buckets.

### Query And Forms

- Create one `QueryClient` and expose it through the typed TanStack Router context in `router.tsx`.
- Define shared `queryOptions` once per operation. The route loader calls `queryClient.ensureQueryData(options)` and the component hook consumes the same options.
- Query functions call the generated API client and pass TanStack Query's abort signal to the request.
- Mutations invalidate only keys whose authoritative results may have changed. Prefer precise keys over global invalidation.
- PostgreSQL and the API remain authoritative; the Query cache is derived, disposable server state. Do not embed mock records in routes, query files, forms, or production components.
- Forms own client interaction only: field interaction, client-safe validation feedback, submission state, and mapping to an operation-specific mutation. API validation and domain behavior remain authoritative.
- Keep forms operation-specific. Extract a form only under the same exact-owner and move-on-extraction rule.

### State And UI

- Put shareable, bookmarkable, navigation-relevant state in validated route search parameters: filters, sort, pagination, tabs, and selected resource identifiers when appropriate.
- Keep ephemeral interaction state local: open menus, temporary draft affordances, hover, focus, and unsubmitted UI state.
- Promote UI to `packages/ui` only after it is product-neutral and reused. Keep workflow components and app-specific composition in `apps/web`.

## E2E Tests

```text
apps/e2e/
|-- package.json
|-- tsconfig.json
|-- playwright.config.ts             # testDir: "./tests"
`-- tests/
    |-- smoke.spec.ts
    `-- <critical-journey>.spec.ts
```

- `apps/e2e` owns browser journeys. Specs describe critical user behavior.
- All E2E records come from the API-owned deterministic reset and E2E seed against an isolated database before each isolation scope. Playwright owns no record definitions.
- Do not create `test-data`, `support`, generic helper, or fixture-data buckets. Add auth setup, fixtures, or page objects only when repeated interaction justifies them.
- Run one worker until each worker has an independent database. Browser contexts isolate browser state but do not isolate shared database state.
- Exercise real web and API processes. Mock only external providers at their boundary; do not mock Talqo HTTP endpoints.
- Prefer user-visible role, accessible name, and label selectors. Never synchronize with fixed sleeps.
- Capture a trace on first retry and a screenshot on failure. Run Chromium for pull requests and all configured browsers nightly or for releases.
- `bun run e2e` runs the noncached Chromium suite.

## Naming And Exceptions

- Module directories and module file stems are singular lower-kebab-case: `project/project.service.ts`. HTTP resource paths may be plural: `/projects`.
- `.contract.ts`, `.routes.ts`, `.service.ts`, `.repository.ts`, `.schema.ts`, and `.seed.ts` are Talqo role suffixes.
- Avoid broad barrels and `public.ts`. Import the owning capability's explicit file or a package's declared export.
- Generated migrations, route trees, OpenAPI artifacts, and generated clients are never hand-edited.
- For a cross-module read or tooling deviation, document the owner, reason, exact scope, and removal trigger beside the code. Put repository-wide or long-lived exceptions in this guide or an ADR.

## Placement Examples

| Change | Place it | Do not place it |
| --- | --- | --- |
| Project creation invariant | `modules/project/project.service.ts` | Route, schema, shared helper |
| Project table and index | `modules/project/project.schema.ts` | Central schema bucket |
| `POST /projects` validation | `modules/project/project.contract.ts` | Web app or generated client |
| Project persistence query | `modules/project/project.repository.ts` | Another module's service |
| Request ID middleware | Named capability under `src/http` | `src/utils` |
| One route's project query policy | Route-owned `-project-query.ts` | Generated API client |
| Reused project settings workflow | `features/project-settings` after moving its sole copies | Mirrored `features/project` by default |
| Neutral reused button | `packages/ui` | API or route feature |
| Critical project journey | `apps/e2e/tests/<journey>.spec.ts` | Web unit test directory |

## Change Checklists

### New API Module

- Name the singular lower-kebab business owner and its owned tables.
- Add only capability-triggered role files.
- Expose cross-module behavior only through the explicit service path.
- Keep Hono in routes and Drizzle values behind service boundaries.
- Compose routes and schemas centrally; generate and inspect one central migration when persistence changes.
- Add colocated behavior tests and document any ownership exception.

### New Web Route Or Feature

- Choose dot notation or a directory from colocation/layout needs; use official route tokens.
- Validate shareable state as search parameters and keep ephemeral state local.
- Keep operation-specific query, mutation, and form files with their single route owner.
- Reuse one `queryOptions` definition in loader and component; pass the abort signal.
- On proven same-semantic reuse, move to one feature owner and remove the old copies.
- Keep generated transport and shared UI free of Query and workflow policy.

### New E2E Journey

- Add deterministic API-owned reset/seed scenarios against the isolated E2E database.
- Test one critical behavior through real web and API processes.
- Use role/label selectors, no sleeps, and mock only external providers.
- Keep lifecycle in fixtures; add saved auth or page objects only when needed.
- Keep one worker until per-worker databases exist; configure required retry artifacts and browser schedules.

## Boundary Enforcement

- Add import-boundary and cycle enforcement when the module graph is large enough to validate the rules against real dependencies.
- Add packages only for measured cross-app reuse; do not pre-split modules or speculative shared code.

## Authoritative References

- [Local ADR guide](adr/AGENTS.md)
- [Hono best practices](https://hono.dev/docs/guides/best-practices)
- [Drizzle configuration](https://orm.drizzle.team/docs/drizzle-config-file)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [TanStack Router file naming](https://tanstack.com/router/latest/docs/framework/react/routing/file-naming-conventions)
- [TanStack Router file-based routing](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing)
- [TanStack Query options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options)
- [Playwright configuration](https://playwright.dev/docs/test-configuration)
- [Playwright isolation](https://playwright.dev/docs/browser-contexts)
- [OpenAPI specification](https://spec.openapis.org/oas/latest.html)
- [Turborepo repository structure](https://turborepo.com/docs/crafting-your-repository/structuring-a-repository)
- [Node.js package exports](https://nodejs.org/api/packages.html#package-entry-points)
- [Bun test runner](https://bun.com/docs/test)
