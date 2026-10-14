# Writing good tests

Read this reference when writing tests, assertions, fixtures, or test doubles.

## Overview

Use [testing-strategy.md](testing-strategy.md) to decide whether a test adds distinct protection and which layer should own it. This reference covers how to write that test.

## Derive expectations

**Derive expectations independently.** Use literals and hand-checked fixtures; table-driven tests with literal `want` values are the preferred shape. Sharing production logic can reproduce the same defect on both sides. This example calls the same query builder for actual and expected values:

```typescript
// This comparison uses the same implementation on both sides.
const expected = buildSearchQuery({ tag: 'urgent' });
expect(buildSearchQuery({ tag: 'urgent' })).toBe(expected);

// The expected query comes from the required format.
expect(buildSearchQuery({ tag: 'urgent' })).toBe('tag:"urgent"');
```

**Avoid change detectors.** Assertions on private structure or incidental wording create churn without protecting behavior. Exact values are useful when they are part of a public contract. Test the behavior that depends on a decision: not `expect(MAX_RETRIES).toBe(5)` but "a failing call is retried 5 times after the initial attempt, with no further attempts."

Do not freeze incidental UI copy. A test that only asserts a static header's current wording adds no protection unless that wording is a requirement. Prefer the user outcome, such as a saved item being available after reload. Text assertions are useful for required content, dynamic data, validation feedback, and accessible names; do not remove them merely because they use text.

**Your code, not the framework.** Test the contract your code makes at its boundaries, such as the query you emit or the payload you produce. Do not test a router's documented dispatch mechanics; test your route's response or side effects. When upstream behavior genuinely surprised you, write one narrow characterization test naming the assumption.

## Exercise real behavior

**Assert contracts, not mock existence.** Exercise real production logic. Assert its outputs or side effects, including calls to a double when arguments, counts, or ordering are part of a boundary contract. Checking only that a mocked component renders its own marker proves little.

Checking that navigation exists is useful only when its presence is the requirement. For a navigation interaction, exercise the real control and assert the intended destination or outcome, not a mocked sidebar's marker.

**Mock at the right level.** Understand the relevant side effects of the real method before replacing it; mock the slow or external operation and keep what the test depends on real. When unsure, run the test against the real implementation first and observe what actually needs to happen.

For example, if duplicate detection reads a generated config, replacing the method that writes it removes behavior the test needs. Control server startup at the external boundary, keep the config write real, and assert duplicate rejection.

**Make doubles specific.** When arguments, call counts, or ordering are part of the contract, assert them. A fake that accepts anything verifies nothing about those contracts. Use distinct responses where needed so the wrong branch cannot satisfy the expectation.

**Use small, valid fixtures.** Include fields required by the boundary contract and those relevant to the behavior under test. Omit unrelated optional fields rather than copying entire payloads. Test missing or malformed fields explicitly where handling them matters; use schema or integration checks when fixture drift is a risk.

**Keep test-only helpers out of production classes.** Test setup and cleanup belong in test utilities. A class that owns a resource may still need a production lifecycle method even if tests are its first caller; decide by ownership and contract, not caller count alone.

**Prefer real components over complex mocks.** When mock setup outgrows the test logic, mocks miss methods the real components have, or tests break when the mock changes, switch to an integration test with real components where practical.

## Check test effectiveness

Before finishing, consider likely regressions in the changed behavior and whether the relevant tests would catch them, prioritizing by risk:

- Wrong constant or argument
- Wrong branch handler
- Missing state change or side effect
- Empty or default return
- Missing validation for zero, empty, nil, unauthorized, or malformed input

An important mutation nothing catches suggests a coverage gap or a tautological test. This is a focused review, not an exhaustive mutation quota.

## Warning signs

- Setup and assertion share the same object, guaranteeing equality
- The test fails on every intentional change, never on accidental breakage
- Expected values reuse production logic
- The test greps source text, or asserts a removed symbol stays removed
- The test would still matter if only the framework remained
- The test exists for coverage, checking no side effect or outcome
- An assertion checks only a `*-mock` test ID rather than a meaningful contract
- A production method exists solely for test setup rather than resource ownership
- Mock setup obscures the behavior, or you cannot explain why the mock is needed
- Mocking "just to be safe"
