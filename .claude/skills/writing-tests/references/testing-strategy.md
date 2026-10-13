# Testing strategy

Use the repository's test conventions and tools. Choose tests by the defects they catch, not directory names or a required test-count distribution.

## Decide whether to add a test

Before writing a test, identify:

- The observable contract and realistic defect it should catch.
- The existing coverage for that behavior, including tests at other layers.
- The distinct protection the proposed test adds.

Reuse an adequate existing test. Update it when its contract changes, or extend it when a related case is missing. Add a separate test for a distinct scenario when that gives clearer setup or failure diagnosis. Do not weaken valid assertions to accommodate a regression.

Do not add tests solely because a function, file, or line changed. Covered behavior-preserving refactors need existing tests, not duplicate coverage. Trivial getters, constants, forwarding, and framework mechanics need no standalone test unless they enforce a meaningful contract. Docs and non-runtime config changes use appropriate static, schema, or manual checks instead.

## Choose the layer

Use the smallest scope that can expose the actual defect without mocking away the behavior being verified. A unit can include collaborating real objects; it does not have to be one function or one class.

| Layer | Question it answers | Typical coverage |
|-------|---------------------|------------------|
| Unit | Does this cohesive piece of logic obey its contract? | Calculations, validation, parsing, transformations, state transitions, meaningful boundaries and invalid inputs. |
| Integration | Do components agree and cooperate across this boundary? | Serialization, persistence, constraints, transactions, authorization enforcement, error translation, retries, duplicate delivery. |
| E2E | Can a user accomplish an important task through the assembled application? | Critical journeys, application wiring, persistence across reloads, selected browser-specific failure and recovery paths. |

Keep the integration under test real. A database substitute cannot prove the real database's constraints or transaction behavior. An E2E test with the application API stubbed cannot prove the browser-to-backend integration; use such a test only when its scope is the browser behavior itself.

Add broader coverage only for a distinct boundary, wiring, or user-experience risk. Do not repeat a validation matrix at unit, integration, and E2E levels. Prefer a focused integration test over a heavily mocked unit test when the defect depends on collaboration. Use static checks for guarantees they can establish; runtime contracts still need runtime verification.

## Frontend and API limits

Keep the same unit, integration, and E2E layers for frontend and API code. These are choices of scope, not suites to populate. A runner such as Vitest does not determine the layer or justify adding tests.

- API unit tests protect business rules and logic. Use integration tests for request handling, authorization enforcement, database constraints, and transactions.
- Frontend unit tests protect nontrivial client-owned logic, such as calculations, selection rules, state transitions, draft reconciliation, or request coordination.
- Do not add a test per component, hook, page, or file. Static presentation, incidental copy, trivial wrappers, and covered interactions need no new test.
- Add a frontend interaction test only for an important, unprotected behavior, such as failed saves losing edits or stale search responses replacing newer results. Choose one suitable scope; do not also add tests for each child and hook.
- Keep relevant components and client logic real. If testing requires replacing internal hooks and children with mocks, reconsider the scope rather than testing the mocks.
- Use a real browser when the defect depends on layout, focus behavior, navigation, or browser APIs. A simulated DOM cannot establish browser fidelity. A mocked API cannot prove backend behavior, and hiding a control cannot prove authorization.

No separate frontend test suite is required when existing coverage adequately protects the client behavior. Reusable components may need tests for their public interaction or callback contracts; private calls and state are not those contracts.

## Select scenarios by risk

Scenario type and test layer are independent. Every layer can have success and failure cases. Consider the following categories only where the changed behavior or a known regression makes them relevant:

- Ordinary use with representative valid input and expected conditions.
- Boundary or complex use, such as limits, empty states, unusual valid input, repeated operations, or interactions between business rules.
- Misuse, such as malformed input, unauthorized actions, or injection attempts.
- Environmental failure, such as timeouts, unavailable dependencies, interrupted operations, or concurrent requests.

This is a risk checklist, not a matrix to fill for every change. Unicode and emoji are valid input unless the contract says otherwise. Treat invalid input and dependency failure as separate risks.

Choose representative cases for equivalent behavior. Parameterize when it clarifies a shared rule; each case must have a reason to exist. Test around specified limits rather than enumerating arbitrary values. Generate oversized data instead of embedding huge documents. Assert the required outcome, such as clean rejection, preserved state, or bounded retries, rather than just no crash.

Inject failures deterministically, usually one relevant failure at a time. Combine failures only when their interaction presents a concrete risk. Use property-based, fuzz, load, or resilience tests when generated inputs or system conditions are the risk; do not reproduce those campaigns as E2E examples.

## Placement examples

These are alternative placements. Add coverage at another layer only for a distinct failure the selected test cannot catch.

| Risk | Initial placement | Broader coverage when needed |
|------|-------------------|------------------------------|
| Emoji counted incorrectly toward a length limit | Unit test of the length rule. | Integration for encoding/storage; browser test for input or rendering defects. |
| Oversized input | Unit test around the validation limit. | Integration for request-size enforcement; browser or performance check for paste responsiveness. |
| Save request times out | Unit test if client retry logic owns the defect. | Browser test if draft preservation or the Retry control is the defect; integration for transport behavior. |
| Access to another user's record | Integration test at the authorization boundary. | E2E if session or navigation behavior adds distinct risk. |
| Duplicate submission | Unit test if local submission logic owns the defect. | Integration for server idempotency; browser test for an event-timing regression. |

## Stop adding tests

Stop when the changed contract and its important failure modes have meaningful protection and no concrete unprotected risk remains in scope. Another input with the same behavior, another internal function, or another layer is not a reason to continue. Multiple assertions can describe one coherent outcome; do not split them merely to achieve one assertion per test.

Review new tests for distinct value before finishing. Remove or consolidate redundancy introduced by the current work, but do not prune unrelated existing tests. Report material verification gaps and skipped checks without inventing tests to make the change look complete. Do not skip a feasible bug regression test merely because the repository previously had no tests.
