# OpenAPI Contract Design

## Purpose

Establish one generated OpenAPI contract between `apps/api` and `apps/web`. The API remains authoritative for transport schemas and route metadata. The web app consumes the committed contract through Orval-generated TanStack Query and Zod code rather than duplicating endpoint types or request functions.

This change migrates every existing API route and every existing handwritten web API consumer in one implementation effort.

## Decisions

- Generate OpenAPI 3.1.1 from API-owned Zod 4 contracts with `@hono/zod-openapi` 1.6.0 and `OpenAPIHono`. Version 1.6.1 was not eligible under the repository's 24-hour minimum package age during implementation.
- Generate a web-specific TanStack Query fetch client and Zod schemas with Orval 8.24.0.
- Commit both `apps/api/openapi.json` and `apps/web/src/api/generated/`.
- Keep the OpenAPI document as a repository artifact; do not serve it from the running API.
- Make contributors responsible for regeneration. CI regenerates artifacts and reports any drift from committed files.
- Treat generated Zod request schemas as baseline wire validation. Derive app-owned form schemas for user experience concerns.
- Treat OpenAPI, not a universal generated client package, as the reusable boundary between API consumers.

## Architecture

The contract flow is one-way and deterministic:

```text
module Zod schemas + route declarations
  -> composed OpenAPIHono application
  -> apps/api/openapi.json
  -> Orval
  -> apps/web/src/api/generated/
  -> web routes and features
```

Each API module owns its request, response, parameter, and error schemas and its route declarations in `<module>.contract.ts`. Each declaration includes a stable `operationId`, tag, method, path, parameters, request body where applicable, intentional response statuses, and security requirements. Protected operations declare cookie authentication; public operations explicitly omit it.

Module `.routes.ts` files register declarations on `OpenAPIHono` and implement their handlers. The route API connects runtime request validation and handler response typing to the same declaration. `app.ts` composes module routes in a fixed order. A dedicated generation entry point imports this composed app and serializes its registry without starting a server.

The generated document uses pretty-printed JSON because the source is a JavaScript object and no YAML serializer is otherwise needed. Generation excludes timestamps, environment-specific server URLs, and other nondeterministic values.

Orval output belongs to `apps/web` because it is tailored to that consumer. It may contain generated TanStack Query hooks, option factories, query-key factories, fetch functions, TypeScript types, and Zod schemas. A future SDK or non-React integration can generate a different client from the same OpenAPI document instead of depending on React-specific output.

## API Contracts

Contract schemas describe JSON wire values rather than service or persistence values. In particular, date-time responses use RFC 3339 strings with OpenAPI `format: date-time`; they do not expose JavaScript `Date` schemas. Routes translate between application values and wire values when their representations differ.

A reusable transport error schema defines the existing JSON shape:

```json
{ "error": "Human-readable message" }
```

Each operation declares the statuses it deliberately produces and the shared unexpected `500` fallback. Authentication middleware, request validation, authorization failures, domain conflicts, not-found responses, and the unhandled-error boundary return the documented JSON shape. Empty successful responses remain explicit `204` responses with no body.

All current routes, including `/health`, appear in the generated document. Stable operation IDs are mandatory and unique because they control generated symbol names. Module tags are stable and control Orval's generated grouping.

## Web Generation

One repository-owned Orval configuration consumes `apps/api/openapi.json` and writes only to `apps/web/src/api/generated/`. Generation uses:

- the React Query client with native fetch;
- Zod 4 classic schemas;
- thrown errors for non-success responses;
- abort-signal support;
- relative API URLs;
- `credentials: "include"` for dashboard session cookies;
- deterministic tag-based output and cleaning limited to generated directories.

The built-in fetch implementation is used instead of a custom mutator; a mutator would bypass Orval's documented generation behavior without adding anything the boundary needs.

Client runtime response validation is deliberately not enabled. At Orval 8.24 its generator emits type-only imports for schemas it then calls as values, producing code that cannot typecheck or run; supporting the feature would require a permanent post-generation patch, which this repository does not accept. Generated Zod schemas are instead consumed at owned boundaries such as form validation, and contract drift is covered by integration and E2E tests. Revisit only when upstream output for that feature typechecks unmodified.

The existing handwritten endpoint functions and duplicated response/request types in `apps/web/src/api/client.ts` are removed. Web call sites consume generated hooks and generated key factories directly. Global defaults remain in the app's `QueryClient`; call sites may supply operation-specific options. Mutation owners explicitly invalidate the generated keys affected by successful writes. Generated code contains no localized messages or UI error presentation.

`apps/web/src/features/authentication/api-error.ts` remains handwritten. It normalizes Orval/fetch failures into the app-facing error representation used by UI code.

## Form Validation

Generated request schemas define baseline API constraints such as required fields, lengths, ranges, patterns, enums, and formats. They are ordinary Zod schemas and can be used through `zodResolver`, but they represent wire contracts rather than complete forms.

An app-owned form schema derives from a generated object schema with `pick`, `omit`, or `safeExtend` when practical. It adds only UI concerns such as:

- localized validation messages;
- confirmation fields;
- input coercion and empty-value handling;
- conditional or cross-field rules through `superRefine`;
- fields used only for display or interaction.

Structural derivation happens before refinements. If generated output is an array, union, intersection, or transformed schema that cannot be extended as an object, the form composes exported item or branch schemas when available. Otherwise it defines a separate UI schema and validates the mapped request payload against the generated wire schema before submission.

Submission mapping removes UI-only fields and converts form-state values into JSON wire values. Server validation remains authoritative; frontend validation improves feedback but never replaces API validation or domain behavior.

## Generation Workflow

A root `contracts:generate` command performs these steps in order:

1. Generate and format `apps/api/openapi.json` from the composed API app.
2. Run pinned Orval against that document.
3. Format `apps/web/src/api/generated/` with the repository formatter.

Contributors run this command whenever API contract declarations or generator configuration changes and commit the resulting artifacts.

A root `contracts:check` command regenerates both artifacts and fails if any tracked artifact would differ, disappear, or be newly created, with instructions to run `bun run contracts:generate`. Generation is deterministic, so a regenerated tree matches the committed one exactly when artifacts are fresh.

CI runs `contracts:check` in a dedicated job. Builds and tests consume committed generated output and do not regenerate it implicitly. Exact generator and integration versions are pinned in the lockfile to make output reproducible.

## Documentation Changes

Implementation updates `docs/architecture.md` to describe consumer-specific generation from the shared OpenAPI boundary. It removes the premature rule that all consumers use one transport-only `packages/api-client` and permits generated query machinery inside a web-owned generated directory. Application code still owns query defaults, invalidation decisions, and error presentation.

A concise ADR records Orval as the selected web OpenAPI generator, including the benefit of generated TanStack Query and Zod integration and the cost of generator-shaped output. Existing ADR-0005 remains valid because OpenAPI continues to be the language-neutral contract.

## Testing

API route tests verify request validation, declared status and body combinations, authentication errors, serialization, and date-time wire values. Contract-focused checks verify that every composed route appears in the document and that operation IDs are unique and stable.

Orval generation against the real OpenAPI 3.1.1 document is an integration check. Generated code is not unit-tested directly; deterministic freshness comparison, typechecking, and consuming behavior cover it.

Web tests cover handwritten behavior only: form-schema extensions, submission mapping, error normalization, and mutation invalidation. Existing unit, integration, and E2E suites verify the migrated auth flows through the generated client.

The implementation is complete when these commands pass:

```sh
bun run contracts:check
bun run quality:fix
bun run typecheck
bun run test
bun run i18n:fix
bun run test:integration
bun run e2e
```

## Out Of Scope

- Serving OpenAPI or interactive API documentation from the API process.
- Generating an SDK, widget client, or non-TypeScript client.
- Adding endpoints or changing business behavior.
- Moving UI-specific validation messages into API schemas.
- Introducing a custom Orval transport mutator.

## Acceptance Criteria

- Every existing API operation is generated from its runtime contract into OpenAPI 3.1.1.
- API handlers cannot return an intentional status/body combination omitted from their route declaration without a type or test failure.
- `apps/api/openapi.json` and `apps/web/src/api/generated/` are committed, deterministic, and never hand-edited.
- Existing web API calls use generated Orval React Query/Zod output with no duplicated endpoint request or response types.
- Generated code typechecks and runs without any post-generation patch or workaround.
- Forms reuse generated request constraints while retaining app-owned localized and cross-field validation.
- CI detects stale or missing generated artifacts by regenerating them and failing on any drift.
- Architecture documentation and the generator ADR match the implemented ownership boundaries.
