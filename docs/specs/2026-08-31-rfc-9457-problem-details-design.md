# RFC 9457 Problem Details Design

## Purpose

Replace every Talqo API error response with an RFC 9457 `application/problem+json` response. The body is language-neutral and contains exactly a resolvable problem type URI and a stable code used by clients as a localization key.

This is an atomic contract migration. The legacy `{ "error": string }` shape and route-specific error extensions are removed without a compatibility period.

## Response Contract

Every API error body contains exactly two required properties:

```json
{
  "type": "https://docs.talqo.chat/problems#invalid-credentials",
  "code": "invalid-credentials"
}
```

- `type` is the RFC 9457 primary problem identifier and resolves to the public problem catalog.
- `code` is a Talqo extension and the canonical language-neutral localization key.
- `title`, `status`, `detail`, `instance`, legacy `error`, and all route-specific properties are absent.
- The HTTP status line remains authoritative.
- Errors use `Content-Type: application/problem+json`; successful JSON remains `application/json`.
- The schema is strict and disallows unknown properties.

## Architecture

`apps/api/src/http` owns one immutable semantic problem catalog, a closed `PROBLEM_CODES` enum-like constant, its derived `ProblemCode` union, and the strict Zod/OpenAPI schema. Each catalog entry binds one kebab-case code to a type URI. The URI is derived as `https://docs.talqo.chat/problems#<code>` rather than repeated manually.

A single response helper serializes catalog entries. A matching OpenAPI helper documents the allowed semantic problems for each status. Routes retain responsibility for selecting HTTP statuses and mapping known domain errors; shared HTTP infrastructure owns only the representation and cross-cutting problems.

The generated OpenAPI contract carries the closed code enum to `apps/web`. The web owns one exhaustive `ProblemCode`-to-literal-i18next-key map. API, web locale, and docs identifiers use the same code values without sharing source across app boundaries or introducing a package.

## Problem Catalog

The initial closed code set is:

| Code | Documentation title | Expected status |
| --- | --- | --- |
| `admin-access-required` | Admin access required | 403 |
| `admin-already-exists` | Admin already exists | 409 |
| `agent-invalid` | Invalid agent | 400 |
| `agent-name-taken` | Agent name already in use | 409 |
| `agent-not-found` | Agent not found | 404 |
| `authentication-required` | Authentication required | 401 |
| `configuration-conflict` | Configuration conflict | 409 |
| `current-password-incorrect` | Current password incorrect | 400 |
| `internal-server-error` | Internal server error | 500 |
| `invalid-ai-provider-configuration` | Invalid AI provider configuration | 400 |
| `invalid-credentials` | Invalid credentials | 401 |
| `invalid-invitation` | Invalid invitation | 409 |
| `invalid-request` | Invalid request | 400 |
| `malformed-json` | Malformed JSON | 400 |
| `model-discovery-unsupported` | Model discovery unsupported | 502 |
| `password-change-not-required` | Password change not required | 409 |
| `password-change-required` | Password change required | 403 |
| `permission-denied` | Permission denied | 403 |
| `provider-credentials-rejected` | Provider credentials rejected | 400 |
| `provider-error` | Provider error | 502 |
| `provider-rate-limited` | Provider rate limited | 429 |
| `provider-unreachable` | Provider unreachable | 502 |
| `request-failed` | Request failed | Original carried 4xx or 5xx status |
| `route-not-found` | Route not found | 404 |
| `self-password-reset-not-allowed` | Self password reset not allowed | 400 |
| `user-not-found` | User not found | 404 |
| `username-taken` | Username already in use | 409 |

Documentation titles satisfy RFC 9457 problem-definition metadata only. They are not API fields or web translation sources and can be localized independently when docs localization is introduced.

The existing model-discovery codes migrate to clearer catalog values: `unauthorized` to `provider-credentials-rejected`, `unreachable` to `provider-unreachable`, `rate-limited` to `provider-rate-limited`, and `unsupported` to `model-discovery-unsupported`. `provider-error` remains unchanged.

## Error Flow

1. Request validation and malformed JSON select `invalid-request` or `malformed-json`.
2. Authentication middleware selects `authentication-required`, `password-change-required`, or `admin-access-required`.
3. Routes map known authorization and domain errors to catalog entries. Dynamic domain and upstream messages never enter responses.
4. Unknown routes return `route-not-found`.
5. Unknown thrown errors are logged and return `internal-server-error`.
6. A response-carrying exception whose body validates as an exact known problem is reserialized through the problem helper. Otherwise it becomes `request-failed`. Both paths preserve its 4xx or 5xx status but not its original body or content type.

Validation details that do not fit the exact schema collapse into the relevant semantic code, such as `agent-invalid` or `invalid-ai-provider-configuration`. Client-side field validation provides specific UI guidance; server logs retain diagnostics.

## Web Localization

All English, Czech, and Chinese web locale files define identical `problems.<code>` keys for the full closed code set. All current direct `info.error` consumers use one handwritten presentation policy. Known codes resolve through the explicit literal-key map; unknown or malformed problem bodies use the existing localized generic error and never expose server text or raw codes.

## Documentation

Add one minimal `apps/docs` problem catalog page at `/problems`. It provides a stable anchor for every code and records the type, documentation title, expected status, meaning, and brief resolution guidance. Do not add docs localization infrastructure in this effort. Keep the architecture update and durable decision record to the minimum needed to establish the canonical API error contract.

## Verification

- API route tests cover representative validation, authentication, authorization, domain, not-found, carried-response, and unexpected-error paths.
- API assertions verify status, exact two-key bodies, and `application/problem+json`.
- Catalog checks verify unique codes, URI/code alignment, the approved URI base, and rejection of legacy or extra keys.
- OpenAPI and generated web artifacts expose the exact schema and closed code enum.
- Web tests verify exhaustive code mapping, known-code localization, identical locale key sets, and localized fallback for unknown codes.
- A focused consistency check verifies that the public catalog contains an anchor for every code.
- Contract generation, formatting, typechecking, unit, integration, E2E, and i18n checks pass.

## Out Of Scope

- Per-occurrence details, field-error arrays, request identifiers, or other problem extensions.
- Content negotiation or server-side localization of problem responses.
- Docs localization infrastructure.
- Compatibility with the legacy error body.
- Unrelated API, web, or documentation refactoring.

## Acceptance Criteria

- Every Talqo-owned API 4xx or 5xx response uses the exact `{ type, code }` schema and `application/problem+json`.
- No API response exposes raw domain, validation, database, or upstream-provider messages.
- Problem codes are a closed, type-checked set shared through OpenAPI generation.
- Every code has matching web locale keys and a public docs anchor.
- Unknown web codes display a localized generic error.
- Generated contracts and all required repository checks pass.
