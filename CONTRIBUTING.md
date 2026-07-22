# Contributing

## Setup

Use the [development container](.devcontainer/devcontainer.json) for a consistent dev experience.

For local setup, install Bun and run:

```sh
bun install
```

## Placement

Use the [architecture guide](docs/architecture.md) for detailed boundaries and conventions.

| Change | Placement |
| --- | --- |
| API domain behavior or a cross-module API | `apps/api/src/modules/<module>/<module>.service.ts` |
| HTTP validation and transport behavior | `<module>.contract.ts` and `<module>.routes.ts` |
| Owned persistence operations | `<module>.repository.ts` |
| Owned tables, relations, indexes, and constraints | `<module>.schema.ts` |
| Web route behavior with one consumer | Colocate it with the route under `apps/web/src/routes` |
| Reused web workflow with identical semantics | Move the sole implementation to `apps/web/src/features/<feature>` |
| Product-neutral, reused presentation | `packages/ui` |
| Internal engineering documentation and ADRs | Root `docs` and `docs/adr` |
| Public product documentation | `apps/docs` |
| Generated API transport client | `packages/api-client` |
| Critical cross-system browser journey | `apps/e2e/tests/<journey>.e2e.ts` |

## Boundaries

- Other API modules may use a module only through its service file. Services expose domain or application values, not transport or persistence types.
- A module writes only its own tables. Cross-module read exceptions must be explicit and read-only.
- Never edit generated migrations, route trees, OpenAPI artifacts, or generated clients by hand.
- Extract shared code only when current callers reuse the same semantics. Packages require measured cross-app reuse and a stable API.
- Add role files and support directories only when their capability exists; do not create empty scaffolds.
- Colocate tests with the layer they verify.

## Testing

| Test | Responsibility |
| --- | --- |
| Unit | Service behavior and pure code, colocated in `*.test.ts` |
| In-process | HTTP validation, status, headers, serialization, and service integration through the composed app in `*.routes.test.ts` |
| Integration | Module behavior through its service interface in `<module>.integration.test.ts` |
| E2E | Critical cross-system journeys in `apps/e2e/tests/*.e2e.ts` |

E2E records come from the API-owned deterministic seed against an isolated E2E database.

## Verification

```sh
bun run quality:fix
bun run typecheck
bun run test
```

Run `bun run build` for build-affecting changes and `bun run e2e` for critical journeys.

## Documentation And Pull Requests

Update `apps/docs` for public product behavior and root `docs` for internal engineering guidance. Keep `docs/architecture.md` aligned with changes to architecture, boundaries, ownership, or canonical structure. Record significant, long-lived decisions in `docs/adr` using its local instructions.

Pull requests must follow the [pull request template](.github/pull_request_template.md), describe verification, and keep documentation and tests aligned with the change.
