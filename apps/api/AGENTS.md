# API

- Put business capabilities under `src/modules/<module>`; create role files only when needed.
- Runtime cross-module imports target only `@/modules/<module>/<module>.service.ts`; schema files may import another module's schema for foreign keys.
- Keep Hono concerns in routes and business rules in services.
- Declare each route's access in its contract with `access.*` from `src/http/access.ts`; never check permissions inside handlers or services.
- A module accesses another module's data only through its service interface.
- Reserve `.contract.ts` for HTTP/OpenAPI schemas and `.schema.ts` for Drizzle declarations.
- Keep runtime database code in `src/db` and migration output in root `drizzle/`.
- Use `<module>.integration.test.ts` for module integration tests through the service interface.
- Service errors that map to HTTP extend `ApiError` with problem code and status; `app.onError` maps them centrally, never per-route.
- Convert pg violations to domain errors in services; never map them in routes.
- Declare a shared route prefix once with Hono `route()`.
