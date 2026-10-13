---
name: writing-tests
description: Use when deciding whether a change needs tests, selecting test layers and scenarios, writing or reviewing unit, integration, or browser E2E tests, or debugging tests and test doubles.
---

# Writing tests

Prefer fewer tests that catch important defects. Reuse existing coverage before adding tests. There is no required order for writing tests and production code. This skill guides verification; it grants no permissions and does not override higher-priority instructions.

## Decide what needs protection

Before adding a test, name the observable contract, realistic defect, existing coverage, and distinct protection the test adds. Reuse adequate coverage. Covered refactors, trivial forwarding, and incidental copy changes do not need new tests. Use schema, static, or manual checks for docs and non-runtime config rather than tests that assert source text exists.

## Choose the scope

Use the smallest scope that exposes the defect without mocking away the behavior under test. Add broader coverage only for distinct integration or user-experience risks, not to repeat the same cases at every layer.

| Layer | Purpose |
|-------|---------|
| Unit | Verify a cohesive piece of logic obeys its contract. |
| Integration | Verify real components agree and cooperate across a boundary. |
| E2E | Verify a user can accomplish an important task through the assembled application. |

Success, boundaries, misuse, and environmental failures can matter at any layer. Select them by the changed behavior and risk; do not fill a mandatory matrix. Keep E2E focused on critical journeys and selected browser or recovery risks.

Frontend code does not need a test per component, hook, or page. Test important, unprotected client-owned behavior. A runner such as Vitest is not a test layer.

## Essential rules

- Assert meaningful outcomes, not private structure, mock existence, or incidental header wording. Required content, dynamic text, validation feedback, and accessible names can justify text assertions.
- Derive expectations from requirements or independently checked examples, not the implementation's own output or helpers.
- Keep real logic and the integration being verified real. Control external, slow, or nondeterministic dependencies at appropriate boundaries.
- Assert mock arguments, counts, or ordering only for meaningful interaction contracts.
- Use small, valid fixtures, isolated state, deterministic failure controls, and meaningful assertions. In browser tests, prefer role/label locators and condition-based waits over DOM structure and fixed sleeps.
- Reuse established tools and helpers. Do not add speculative test infrastructure, per-file test quotas, or duplicate scenarios across layers.
- A first-run pass is normal. Check whether a realistic defect would fail the test; never force a failure or rewrite valid production code to satisfy a sequence.
- Add or improve feasible bug regression coverage even in previously untested code. Verify defective behavior when practical, without making it a required implementation order.

## Verify and stop

Run focused checks, then broaden according to risk. Investigate unexpected failures and warnings without hiding pre-existing issues. Report checks actually run, results, and material verification gaps; do not claim an unobserved reproduction.

Stop adding tests when the changed contract and important failure modes are protected and no concrete unprotected risk remains in scope. Remove redundancy introduced by the current work, not unrelated existing tests. Multiple assertions can describe one coherent outcome.

## References

- Read [testing strategy](references/testing-strategy.md) when selecting or expanding coverage, choosing layers, or deciding when tests are unnecessary.
- Read [writing good tests](references/writing-good-tests.md) when writing or changing assertions, fixtures, or test doubles.
- Read [browser testing](references/browser-testing.md) when writing or debugging browser E2E tests, including Playwright specs, visual checks, or accessibility checks.
