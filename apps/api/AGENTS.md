# API

- Put business capabilities under `src/modules/<module>`; create role files only when needed.
- Runtime cross-module business calls target only `@/modules/<module>/<module>.service.ts`. Contracts may import another module's contract schemas; schema files may import another module's schema for foreign keys.
- Keep Hono concerns in routes and business rules in services.
- Declare each route's access in its contract with `access.*` from `src/http/access.ts`; handlers do not check permissions.
- Agent capabilities are scoped through roles, not global grants. Use `access.agent` for agent paths and `access.embed` for embeds. Collection services receive the actor and filter by the relevant capability before pagination or aggregation. Empty scopes never mean unrestricted access.
- The roles service also checks the caller and targeted global and agent-scoped permissions inside `withAccessLock` for access-management writes, including invitations, role assignment, password reset, and deletion. Invitation acceptance rechecks the inviter's current authority. Every role mutation takes this lock so checks and writes cannot race. Do not nest locked operations.
- A module accesses another module's data only through its service interface.
- Reserve `.contract.ts` for HTTP/OpenAPI schemas and `.schema.ts` for Drizzle declarations.
- The identity contract owns the shared user response schema; the roles contract reuses its fields for user listings.
- Keep runtime database code in `src/db` and migration output in root `drizzle/`.
- Use `<module>.integration.test.ts` for module integration tests through the service interface.
- Service errors that map to HTTP extend `ApiError` with problem code and status; `app.onError` maps them centrally, never per-route.
- Convert pg violations to domain errors in services; never map them in routes.
- Declare a shared route prefix once with Hono `route()`.
- Wide events (`src/http/wide-event.ts`) never carry raw paths, query strings, headers, bodies, error messages, usernames, IP addresses, or conversation IDs, which are the chat bearer credential. Log derived IDs, counts, and enums.
- A new ID route param needs a `ROUTE_ID_FIELDS` entry to be logged. Streaming routes wrap their work in `deferWideEvent` so the event covers the whole stream.
