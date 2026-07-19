# API

- Put business capabilities under `src/modules/<module>`; create role files only when needed.
- Other modules may import only `@/modules/<module>/<module>.service.ts`.
- Keep Hono concerns in routes and business rules in services.
- A module writes only its own tables; cross-module reads require an explicit read-model exception.
- Reserve `.contract.ts` for HTTP/OpenAPI schemas and `.schema.ts` for Drizzle declarations.
- Keep runtime database code in `src/db` and migration output in root `drizzle/`.
- Use `<module>.integration.test.ts` for module/PostgreSQL integration tests.
