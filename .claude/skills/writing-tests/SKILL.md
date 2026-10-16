---
name: writing-tests
description: Use when deciding whether a change needs tests, selecting test layers and scenarios, writing or reviewing unit, integration, or browser E2E tests, or debugging tests and test doubles.
---

# Writing tests

Prefer fewer tests that catch important defects.

## Choose scope

- Name the observable contract, realistic defect, existing coverage, and distinct protection before adding a test. Reuse adequate coverage.
- Use the smallest scope that exposes the defect without mocking away the behavior under test. Unit tests protect logic, integration tests protect boundaries, and E2E tests protect critical user journeys.
- Select success, boundary, misuse, and environmental-failure cases by risk. Add broader coverage only for distinct integration or browser risks.

## Essential rules

- Assert observable outcomes, not private structure, mock existence, or incidental copy. Text assertions should protect required content, dynamic data, validation feedback, or accessible names.
- Derive expectations from requirements or independently checked examples, never production output or helpers.
- Keep tested logic and integrations real. Control external, slow, or nondeterministic dependencies at their boundaries. Assert mock arguments, counts, or ordering only for meaningful interaction contracts.
- Use small valid fixtures, isolated state, deterministic failure controls, and meaningful assertions. Browser tests use role/label locators and condition-based waits.
- Reuse established tools and helpers. Avoid speculative test infrastructure and duplicate scenarios across layers.
- Stop when the changed contract and important failure modes are protected. Remove redundancy introduced by the current work.

## Reproduction and test effectiveness

- Add feasible bug regression coverage, including in previously untested code. Run it against defective behavior and the fix when feasible, using an isolated checkout if implementation already exists.
- Check a passing test against realistic faulty behavior.
- Report unavailable failure evidence. Do not claim an unobserved reproduction or demonstrated regression protection.

## Verify and report

Run focused checks, then broaden according to risk. Investigate unexpected failures and warnings without hiding pre-existing issues. Report checks actually run, results, and material verification gaps; do not claim an unobserved reproduction.

## References

- Read [testing strategy](references/testing-strategy.md) for coverage selection and artifact-appropriate checks.
- Read [writing good tests](references/writing-good-tests.md) for assertion, fixture, and test-double examples.
- Read [browser testing](references/browser-testing.md) for browser E2E, visual, and accessibility checks.
