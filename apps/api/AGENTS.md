# API

- Put business capabilities under `src/modules/<module>`; create role files only when needed.
- Runtime cross-module imports target only `@/modules/<module>/<module>.service.ts`; schema files may import another module's schema for foreign keys.
- Keep Hono concerns in routes and business rules in services.
- Declare each route's access in its contract with `access.*` from `src/http/access.ts`; handlers do not check permissions.
- The roles service also checks the caller and targeted permissions inside `withAccessLock` for access-management writes, including account reset and deletion. Every role mutation takes this lock so checks and writes cannot race. Do not nest locked operations.
- A module accesses another module's data only through its service interface.
- Reserve `.contract.ts` for HTTP/OpenAPI schemas and `.schema.ts` for Drizzle declarations.
- Keep runtime database code in `src/db` and migration output in root `drizzle/`.
- Use `<module>.integration.test.ts` for module integration tests through the service interface.
- Service errors that map to HTTP extend `ApiError` with problem code and status; `app.onError` maps them centrally, never per-route.
- Convert pg violations to domain errors in services; never map them in routes.
- Declare a shared route prefix once with Hono `route()`.
